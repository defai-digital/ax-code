#!/usr/bin/env python3
"""Inspect runtime archives without extracting them or modifying signed bytes."""
import argparse
from collections import deque
from pathlib import Path
import re
import stat
import tarfile
import zipfile

ROOT_FILES = {
    'package.json', 'package-lock.json', 'runtime-manifest.json',
    'runtime-integrity.json', 'runtime-integrity.json.minisig',
    'LICENSE', 'LICENSE-MIT', 'NOTICE',
}
ROOT_DIRS = {'bin', 'lib', 'node', 'node_modules', 'engine'}
LICENSES = {'LICENSE', 'LICENSE-MIT', 'NOTICE'}
FORBIDDEN = {'.git', '.internal', '.ssh', '.aws', '.azure', '.gnupg', 'agents.md'}
PRIVATE_KEY = re.compile(rb'(?:\A|\r?\n)-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----')


def inspect_payload(stream, name):
    previous = b''
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            break
        data = previous + chunk
        if b'-----BEGIN ' in data and PRIVATE_KEY.search(data):
            raise ValueError('Private key material in runtime: ' + name)
        previous = data[-256:]


def safe_path(value):
    if not value or '\\' in value or '\x00' in value or value.startswith('/'):
        raise ValueError('Unsafe archive path: ' + repr(value))
    value = value.removeprefix('./').rstrip('/')
    if value in {'', '.'}:
        return ''
    parts = value.split('/')
    if any(p in {'', '.', '..'} or ':' in p for p in parts):
        raise ValueError('Unsafe archive path: ' + value)
    return value


def inspect_entries(entries, require_licenses=False):
    seen = {}
    links = {}
    expanded_size = 0
    for raw_name, kind, size, target in entries:
        name = safe_path(raw_name)
        if not name:
            if kind != 'directory':
                raise ValueError('Invalid archive root')
            continue
        if name.casefold() in seen:
            raise ValueError('Duplicate archive path: ' + name)
        seen[name.casefold()] = (name, kind)
        if len(seen) > 100000 or size < 0:
            raise ValueError('Invalid archive size')
        expanded_size += size
        if expanded_size > 4 * 1024**3:
            raise ValueError('Expanded runtime exceeds size limit')
        parts = name.split('/')
        if any(p.lower() in FORBIDDEN or p.lower().startswith('.env') or
               p.lower() in {'.npmrc', '.pypirc', 'credentials', 'id_rsa', 'id_ed25519'} or
               p.lower().endswith(('.key', '.p12', '.pfx')) for p in parts):
            raise ValueError('Private metadata or credential path: ' + name)
        if parts[0] not in ROOT_DIRS and not (name in ROOT_FILES and kind == 'file'):
            raise ValueError('Unapproved runtime root: ' + name)
        if name in ROOT_DIRS and kind != 'directory':
            raise ValueError('Runtime directory replaced by a file or link: ' + name)
        if name.startswith('node_modules/@ax-code/') and (name.endswith('.map') or
                (name.endswith(('.ts', '.tsx')) and not name.endswith('.d.ts'))):
            raise ValueError('Private workspace source or map: ' + name)
        if parts[0] == 'lib' and name != 'lib' and (name != 'lib/index-node-tui.js' or kind != 'file'):
            raise ValueError('Unapproved core implementation or sourcemap: ' + name)
        if parts[0] == 'bin' and name != 'bin' and name not in {'bin/ax-code', 'bin/ax-code.cmd'}:
            raise ValueError('Unapproved runtime launcher: ' + name)
        if kind not in {'file', 'directory', 'symlink', 'hardlink'}:
            raise ValueError('Special archive member: ' + name)
        if kind in {'symlink', 'hardlink'}:
            if not target or target.startswith('/') or '\\' in target or '\x00' in target or ':' in target:
                raise ValueError('Unsafe archive link: ' + name)
            links[name] = (kind, target)

    # Resolve links in archive space, including indirect links and parent traversal.
    # Dependency launchers legitimately use ../package/bin.js.
    for name, (kind, target) in links.items():
        resolved = name.split('/')[:-1] if kind == 'symlink' else []
        pending = deque(target.split('/'))
        traversed = set()
        while pending:
            part = pending.popleft()
            if part in {'', '.'}:
                continue
            if part == '..':
                if not resolved:
                    raise ValueError('Archive link escapes runtime: ' + name)
                resolved.pop()
                continue
            resolved.append(part)
            candidate = '/'.join(resolved)
            if candidate in links:
                if candidate in traversed:
                    raise ValueError('Cyclic archive link: ' + name)
                traversed.add(candidate)
                next_kind, next_target = links[candidate]
                resolved = resolved[:-1] if next_kind == 'symlink' else []
                pending.extendleft(reversed(next_target.split('/')))
        target_name = '/'.join(resolved)
        if not target_name or not (target_name.casefold() in seen or
                any(p.startswith(target_name.casefold() + '/') for p in seen)):
            raise ValueError('Archive link target is missing: ' + name)
        if kind == 'hardlink' and seen.get(target_name.casefold(), ('', ''))[1] != 'file':
            raise ValueError('Archive hardlink target is not a regular file: ' + name)

    required = {'bin/ax-code', 'lib/index-node-tui.js', 'package.json', 'runtime-manifest.json'}
    if require_licenses:
        required |= LICENSES
    if any(seen.get(name.casefold()) != (name, 'file') for name in required):
        raise ValueError('Required runtime files or licenses missing')
    return len(seen)


def check_archive(archive, require_licenses=False):
    archive = Path(archive)
    if archive.name.endswith('.zip'):
        with zipfile.ZipFile(archive) as contents:
            def entries():
                for item in contents.infolist():
                    mode = item.external_attr >> 16
                    kind = 'directory' if item.is_dir() else 'symlink' if stat.S_ISLNK(mode) else 'file'
                    if stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK}:
                        kind = 'special'
                    if item.flag_bits & 1:
                        raise ValueError('Encrypted archive member')
                    if kind == 'symlink' and item.file_size > 4096:
                        raise ValueError('Oversized archive link')
                    yield item.filename, kind, item.file_size, contents.read(item).decode() if kind == 'symlink' else ''
                    if kind == 'file':
                        with contents.open(item) as stream:
                            inspect_payload(stream, item.filename)
            return inspect_entries(entries(), require_licenses)
    if archive.name.endswith('.tar.gz'):
        with tarfile.open(archive, 'r:gz') as contents:
            def entries():
                for item in contents:
                    yield item.name, 'file' if item.isfile() else 'directory' if item.isdir() else \
                        'symlink' if item.issym() else 'hardlink' if item.islnk() else 'special', item.size, item.linkname
                    if item.isfile():
                        with contents.extractfile(item) as stream:
                            inspect_payload(stream, item.name)
            return inspect_entries(entries(), require_licenses)
    raise ValueError('Expected a runtime .zip or .tar.gz archive')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-licenses', action='store_true', help='Required for all future release builds')
    parser.add_argument('archives', nargs='+')
    args = parser.parse_args()
    for archive in args.archives:
        print(f'Verified runtime content: {Path(archive).name} ({check_archive(archive, args.require_licenses)} members)')


if __name__ == '__main__':
    main()
