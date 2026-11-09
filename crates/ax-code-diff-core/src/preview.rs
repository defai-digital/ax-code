/*
Line diff path selection and hunk construction adapted from jsdiff 9.0.0
(diff/base.js and patch/create.js), https://github.com/kpdecker/jsdiff.

BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
use crate::{Error, Result};
use serde::Serialize;
use std::collections::HashMap;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_LINES: usize = 200_000;
const MAX_COMPONENTS: usize = 1_000_000;
const MAX_WORK: usize = 8_000_000;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
/// Search work allowed for one gap between coarse-fallback anchors. All gaps
/// together share a further MAX_WORK, so the fallback stays bounded.
const MAX_GAP_WORK: usize = 1_000_000;

fn check(cancel: &dyn Fn() -> bool) -> Result<()> {
    if cancel() {
        return Err(Error::new("Native diff cancelled"));
    }
    Ok(())
}
fn limit() -> Error {
    Error::new("Diff resource limit exceeded; split the edit into smaller changes")
}

/// Why the edit-distance search stopped. Only `Exhausted` (the work budget or
/// the search arena ran out) may fall back to a coarse preview; cancellation
/// and every other failure stays a hard error.
enum Stop {
    Exhausted,
    Fail(Error),
}
impl From<Error> for Stop {
    fn from(error: Error) -> Self {
        Self::Fail(error)
    }
}
type Search<T> = std::result::Result<T, Stop>;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Equal,
    Add,
    Remove,
}
#[derive(Clone, Copy)]
struct Component {
    kind: Kind,
    count: usize,
    previous: Option<usize>,
}
#[derive(Clone, Copy)]
struct Path {
    old: isize,
    last: Option<usize>,
}

fn push(arena: &mut Vec<Component>, path: &mut Path, kind: Kind, count: usize) -> Search<()> {
    if count == 0 {
        return Ok(());
    }
    if arena.len() >= MAX_COMPONENTS {
        return Err(Stop::Exhausted);
    }
    let previous = path.last;
    let component = match previous.map(|i| arena[i]) {
        Some(last) if last.kind == kind => Component {
            kind,
            count: last.count + count,
            previous: last.previous,
        },
        _ => Component {
            kind,
            count,
            previous,
        },
    };
    path.last = Some(arena.len());
    arena.push(component);
    Ok(())
}

struct Budget<'a> {
    cancel: &'a dyn Fn() -> bool,
    work: usize,
    max: usize,
    /// Extra cap on search steps alone; tests lower it to force the fallback.
    search: usize,
}
impl Budget<'_> {
    fn tick(&mut self) -> Result<()> {
        self.work += 1;
        if self.work > self.max {
            return Err(limit());
        }
        check(self.cancel)
    }
    /// Same accounting as `tick`, but reports search exhaustion separately.
    fn step(&mut self) -> Search<()> {
        self.work += 1;
        if self.work > self.max || self.search == 0 {
            return Err(Stop::Exhausted);
        }
        self.search -= 1;
        Ok(check(self.cancel)?)
    }
}

fn common(
    path: &mut Path,
    diagonal: isize,
    old: &[&str],
    new: &[&str],
    arena: &mut Vec<Component>,
    budget: &mut Budget,
) -> Search<isize> {
    let mut pos = path.old - diagonal;
    let mut count = 0;
    while path.old + 1 < old.len() as isize && pos + 1 < new.len() as isize {
        budget.step()?;
        if old[(path.old + 1) as usize] != new[(pos + 1) as usize] {
            break;
        }
        path.old += 1;
        pos += 1;
        count += 1;
    }
    push(arena, path, Kind::Equal, count)?;
    Ok(pos)
}

fn components(old: &[&str], new: &[&str], budget: &mut Budget) -> Search<Vec<Component>> {
    let max = old.len() + new.len();
    let offset = max + 1;
    let mut best: Vec<Option<Path>> = vec![None; 2 * max + 3];
    let mut arena = Vec::new();
    let mut first = Path {
        old: -1,
        last: None,
    };
    let pos = common(&mut first, 0, old, new, &mut arena, budget)?;
    let mut done = if first.old + 1 == old.len() as isize && pos + 1 == new.len() as isize {
        Some(first)
    } else {
        None
    };
    best[offset] = Some(first);
    let mut min = -(max as isize);
    let mut max_diagonal = max as isize;
    'search: for edits in 1..=max {
        if done.is_some() {
            break;
        }
        let mut diagonal = min.max(-(edits as isize));
        while diagonal <= max_diagonal.min(edits as isize) {
            budget.step()?;
            let i = (offset as isize + diagonal) as usize;
            let remove = best[i - 1].take();
            let add = best[i + 1];
            let can_add =
                add.is_some_and(|p| p.old - diagonal >= 0 && p.old - diagonal < new.len() as isize);
            let can_remove = remove.is_some_and(|p| p.old + 1 < old.len() as isize);
            if !can_add && !can_remove {
                best[i] = None;
                diagonal += 2;
                continue;
            }
            let mut path;
            if !can_remove || (can_add && remove.unwrap().old < add.unwrap().old) {
                path = add.unwrap();
                push(&mut arena, &mut path, Kind::Add, 1)?;
            } else {
                path = remove.unwrap();
                path.old += 1;
                push(&mut arena, &mut path, Kind::Remove, 1)?;
            }
            let pos = common(&mut path, diagonal, old, new, &mut arena, budget)?;
            if path.old + 1 >= old.len() as isize && pos + 1 >= new.len() as isize {
                done = Some(path);
                break 'search;
            }
            best[i] = Some(path);
            if path.old + 1 >= old.len() as isize {
                max_diagonal = max_diagonal.min(diagonal - 1);
            }
            if pos + 1 >= new.len() as isize {
                min = min.max(diagonal + 1);
            }
            diagonal += 2;
        }
    }
    let mut last = done.ok_or(Stop::Exhausted)?.last;
    let mut result = Vec::new();
    while let Some(i) = last {
        budget.step()?;
        result.push(arena[i]);
        last = arena[i].previous;
    }
    result.reverse();
    Ok(result)
}

/// Appends a run, coalescing it with a preceding run of the same kind.
fn emit(out: &mut Vec<Component>, kind: Kind, count: usize) {
    if count == 0 {
        return;
    }
    if let Some(last) = out.last_mut().filter(|last| last.kind == kind) {
        last.count += count;
        return;
    }
    out.push(Component {
        kind,
        count,
        previous: None,
    });
}

/// Lines occurring exactly once in each side, paired in old order and
/// reduced to the longest run that also increases in new order (patience
/// diff anchors). O(n log n) time and O(n) memory.
fn anchors(old: &[&str], new: &[&str], cancel: &dyn Fn() -> bool) -> Result<Vec<(usize, usize)>> {
    // (count in old, index in old, count in new, index in new)
    let mut seen: HashMap<&str, (usize, usize, usize, usize)> = HashMap::with_capacity(old.len());
    for (i, line) in old.iter().enumerate() {
        check(cancel)?;
        let entry = seen.entry(line).or_insert((0, 0, 0, 0));
        entry.0 += 1;
        entry.1 = i;
    }
    for (i, line) in new.iter().enumerate() {
        check(cancel)?;
        if let Some(entry) = seen.get_mut(line) {
            entry.2 += 1;
            entry.3 = i;
        }
    }
    let mut pairs = Vec::new();
    for line in old {
        check(cancel)?;
        let (old_count, old_index, new_count, new_index) = seen[line];
        if old_count == 1 && new_count == 1 {
            pairs.push((old_index, new_index));
        }
    }
    let mut tails: Vec<usize> = Vec::new();
    let mut back: Vec<Option<usize>> = vec![None; pairs.len()];
    for (i, &(_, new_index)) in pairs.iter().enumerate() {
        check(cancel)?;
        let at = tails.partition_point(|&t| pairs[t].1 < new_index);
        if at > 0 {
            back[i] = Some(tails[at - 1]);
        }
        if at == tails.len() {
            tails.push(i);
        } else {
            tails[at] = i;
        }
    }
    let mut result = Vec::with_capacity(tails.len());
    let mut cursor = tails.last().copied();
    while let Some(i) = cursor {
        result.push(pairs[i]);
        cursor = back[i];
    }
    result.reverse();
    Ok(result)
}

/// Bounded replacement for `components` once the exact search is exhausted.
/// The common prefix and suffix stay exact. Unique-line anchors split the
/// middle; each gap between anchors gets a small exact search and otherwise
/// becomes one remove-all/add-all replacement. The result is a valid edit
/// script, so the hunks built from it apply exactly, but it need not be
/// minimal or match jsdiff.
fn coarse(old: &[&str], new: &[&str], cancel: &dyn Fn() -> bool) -> Result<Vec<Component>> {
    let mut prefix = 0;
    while prefix < old.len() && prefix < new.len() && old[prefix] == new[prefix] {
        check(cancel)?;
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old.len() - prefix
        && suffix < new.len() - prefix
        && old[old.len() - 1 - suffix] == new[new.len() - 1 - suffix]
    {
        check(cancel)?;
        suffix += 1;
    }
    let old_mid = &old[prefix..old.len() - suffix];
    let new_mid = &new[prefix..new.len() - suffix];
    let mut out = Vec::new();
    emit(&mut out, Kind::Equal, prefix);
    let anchors = anchors(old_mid, new_mid, cancel)?;
    // Without anchors the only gap is the span the exact search just failed
    // on, so searching it again would only repeat that work.
    let search = !anchors.is_empty();
    let mut remaining = MAX_WORK;
    let (mut old_at, mut new_at) = (0, 0);
    let end = (old_mid.len(), new_mid.len());
    for &(old_anchor, new_anchor) in anchors.iter().chain(std::iter::once(&end)) {
        check(cancel)?;
        let old_gap = &old_mid[old_at..old_anchor];
        let new_gap = &new_mid[new_at..new_anchor];
        let mut exact = None;
        if search && !old_gap.is_empty() && !new_gap.is_empty() && remaining > 0 {
            let mut budget = Budget {
                cancel,
                work: 0,
                max: remaining.min(MAX_GAP_WORK),
                search: usize::MAX,
            };
            match components(old_gap, new_gap, &mut budget) {
                Ok(changes) => exact = Some(changes),
                Err(Stop::Exhausted) => {}
                Err(Stop::Fail(error)) => return Err(error),
            }
            remaining = remaining.saturating_sub(budget.work);
        }
        match exact {
            Some(changes) => {
                for change in changes {
                    emit(&mut out, change.kind, change.count);
                }
            }
            None => {
                emit(&mut out, Kind::Remove, old_gap.len());
                emit(&mut out, Kind::Add, new_gap.len());
            }
        }
        if (old_anchor, new_anchor) != end {
            emit(&mut out, Kind::Equal, 1);
        }
        (old_at, new_at) = (old_anchor + 1, new_anchor + 1);
    }
    emit(&mut out, Kind::Equal, suffix);
    Ok(out)
}

/// Runs the exact search. When `fallback` is set and only the search budget
/// runs out, returns the coarse edit script and sets `approximate`.
fn diff(
    old: &[&str],
    new: &[&str],
    fallback: bool,
    approximate: &mut bool,
    budget: &mut Budget,
) -> Result<Vec<Component>> {
    let start = budget.work;
    match components(old, new, budget) {
        Ok(changes) => Ok(changes),
        Err(Stop::Fail(error)) => Err(error),
        Err(Stop::Exhausted) if !fallback => Err(limit()),
        Err(Stop::Exhausted) => {
            // The failed search's work is spent; restore the linear phases'
            // allowance, since the fallback carries its own bound.
            budget.work = start;
            *approximate = true;
            coarse(old, new, budget.cancel)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hunk {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
    lines: Vec<String>,
}
#[derive(Serialize)]
struct Preview {
    version: u32,
    hunks: Vec<Hunk>,
    additions: usize,
    deletions: usize,
    /// Present (and true) only when the coarse fallback produced this
    /// preview, so previews within budget stay byte-identical.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    approximate: bool,
}

fn tokens<'a>(text: &'a str, budget: &mut Budget) -> Result<Vec<&'a str>> {
    let mut lines = Vec::new();
    for line in text.split_inclusive('\n') {
        budget.tick()?;
        if lines.len() >= MAX_LINES {
            return Err(limit());
        }
        lines.push(line);
    }
    Ok(lines)
}

fn add_lines(
    target: &mut Vec<String>,
    prefix: char,
    lines: &[&str],
    bytes: &mut usize,
    budget: &mut Budget,
) -> Result<()> {
    for line in lines {
        budget.tick()?;
        *bytes += line.len() + 32;
        if *bytes > MAX_OUTPUT {
            return Err(limit());
        }
        target.push(format!(
            "{prefix}{}",
            line.strip_suffix('\n').unwrap_or(line)
        ));
        if !line.ends_with('\n') {
            target.push("\\ No newline at end of file".into());
        }
    }
    Ok(())
}

fn hunks(
    old: &[&str],
    new: &[&str],
    changes: &[Component],
    budget: &mut Budget,
) -> Result<Vec<Hunk>> {
    let mut output = Vec::new();
    let (mut old_pos, mut new_pos) = (0, 0);
    let mut active: Option<Hunk> = None;
    let mut previous: &[&str] = &[];
    let mut bytes = 0;
    let empty = Component {
        kind: Kind::Equal,
        count: 0,
        previous: None,
    };
    for (i, change) in changes.iter().chain(std::iter::once(&empty)).enumerate() {
        budget.tick()?;
        let lines = if change.kind == Kind::Remove {
            &old[old_pos..old_pos + change.count]
        } else {
            &new[new_pos..new_pos + change.count]
        };
        if change.kind != Kind::Equal {
            if active.is_none() {
                let context = previous.len().min(4);
                let mut hunk = Hunk {
                    old_start: old_pos + 1 - context,
                    new_start: new_pos + 1 - context,
                    old_lines: 0,
                    new_lines: 0,
                    lines: Vec::new(),
                };
                add_lines(
                    &mut hunk.lines,
                    ' ',
                    &previous[previous.len() - context..],
                    &mut bytes,
                    budget,
                )?;
                active = Some(hunk);
            }
            add_lines(
                &mut active.as_mut().unwrap().lines,
                if change.kind == Kind::Add { '+' } else { '-' },
                lines,
                &mut bytes,
                budget,
            )?;
        } else if let Some(mut hunk) = active.take() {
            if lines.len() <= 8 && i + 1 < changes.len() {
                add_lines(&mut hunk.lines, ' ', lines, &mut bytes, budget)?;
                active = Some(hunk);
            } else {
                let context = lines.len().min(4);
                add_lines(&mut hunk.lines, ' ', &lines[..context], &mut bytes, budget)?;
                hunk.old_lines = old_pos + 1 - hunk.old_start + context;
                hunk.new_lines = new_pos + 1 - hunk.new_start + context;
                output.push(hunk);
            }
        }
        if change.kind != Kind::Add {
            old_pos += change.count;
        }
        if change.kind != Kind::Remove {
            new_pos += change.count;
        }
        previous = lines;
    }
    Ok(output)
}

fn counts(changes: &[Component]) -> (usize, usize) {
    (
        changes
            .iter()
            .filter(|c| c.kind == Kind::Add)
            .map(|c| c.count)
            .sum(),
        changes
            .iter()
            .filter(|c| c.kind == Kind::Remove)
            .map(|c| c.count)
            .sum(),
    )
}

/// Exact preview; rejects inputs whose edit-distance search exceeds the work
/// budget. Matches jsdiff output, which the native CLI path relies on.
pub fn preview(old: &str, new: &str, normalize: bool, cancel: &dyn Fn() -> bool) -> Result<String> {
    run(old, new, normalize, false, usize::MAX, cancel)
}

/// Like `preview`, but when only the edit-distance work budget runs out it
/// returns a coarser valid preview marked `"approximate": true` instead of an
/// error. Inputs within budget produce exactly the `preview` output. Byte,
/// line, output and cancellation failures still reject.
pub fn preview_with_fallback(
    old: &str,
    new: &str,
    normalize: bool,
    cancel: &dyn Fn() -> bool,
) -> Result<String> {
    run(old, new, normalize, true, usize::MAX, cancel)
}

fn run(
    old: &str,
    new: &str,
    normalize: bool,
    fallback: bool,
    search: usize,
    cancel: &dyn Fn() -> bool,
) -> Result<String> {
    check(cancel)?;
    if old.len() + new.len() > MAX_BYTES {
        return Err(limit());
    }
    let mut budget = Budget {
        cancel,
        work: 0,
        max: MAX_WORK,
        search,
    };
    let mut approximate = false;
    let normalized_old;
    let normalized_new;
    let needs_normalize = normalize && (old.contains("\r\n") || new.contains("\r\n"));
    let (before, after) = if needs_normalize {
        normalized_old = old.replace("\r\n", "\n");
        normalized_new = new.replace("\r\n", "\n");
        (normalized_old.as_str(), normalized_new.as_str())
    } else {
        (old, new)
    };
    let old_lines = tokens(before, &mut budget)?;
    let new_lines = tokens(after, &mut budget)?;
    let changes = diff(
        &old_lines,
        &new_lines,
        fallback,
        &mut approximate,
        &mut budget,
    )?;
    let hunks = hunks(&old_lines, &new_lines, &changes, &mut budget)?;
    let (additions, deletions) = if needs_normalize {
        counts(&diff(
            &tokens(old, &mut budget)?,
            &tokens(new, &mut budget)?,
            fallback,
            &mut approximate,
            &mut budget,
        )?)
    } else {
        counts(&changes)
    };
    check(cancel)?;
    let result = serde_json::to_string(&Preview {
        version: 1,
        hunks,
        additions,
        deletions,
        approximate,
    })
    .map_err(|e| Error::new(e.to_string()))?;
    if result.len() > MAX_OUTPUT {
        return Err(limit());
    }
    check(cancel)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_newline_cancel_and_budgets() {
        let cancel = || false;
        let output: serde_json::Value =
            serde_json::from_str(&preview("a", "a\n", false, &cancel).unwrap()).unwrap();
        assert_eq!(output["additions"], 1);
        assert_eq!(output["deletions"], 1);
        assert_eq!(
            output["hunks"][0]["lines"],
            serde_json::json!(["-a", "\\ No newline at end of file", "+a"])
        );
        assert!(
            preview("", "", false, &cancel)
                .unwrap()
                .contains("\"hunks\":[]")
        );
        assert!(preview(&"\n".repeat(MAX_LINES + 1), "", false, &cancel).is_err());
        let old = (0..3000).map(|i| format!("a{i}\n")).collect::<String>();
        let new = old.replace('a', "b");
        assert!(
            preview(&old, &new, false, &cancel)
                .unwrap_err()
                .reason
                .contains("limit")
        );
        let cancel = || true;
        assert!(
            preview("a", "b", false, &cancel)
                .unwrap_err()
                .reason
                .contains("cancelled")
        );
    }

    fn parse(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }
    fn roundtrip(before: &str, preview: &serde_json::Value) -> String {
        crate::hunks::apply(before, &preview["hunks"].to_string(), &|| false).unwrap()
    }
    fn rewrite(lines: usize, tag: &str, eol: &str) -> String {
        (0..lines)
            .map(|i| {
                format!(
                    "  const v{i} = compute({}, \"{tag}{i}\"){eol}",
                    i * 7919 % 10007
                )
            })
            .collect()
    }

    #[test]
    fn full_rewrite_falls_back_to_one_exact_replacement() {
        let cancel = || false;
        for eol in ["\n", "\r\n"] {
            let before = rewrite(10_000, "a", eol);
            let after = rewrite(10_000, "b中文😀", eol) + "tail without newline";
            assert!(preview(&before, &after, false, &cancel).is_err());
            let output = parse(&preview_with_fallback(&before, &after, false, &cancel).unwrap());
            assert_eq!(output["approximate"], true);
            assert_eq!(output["version"], 1);
            assert_eq!(output["deletions"], 10_000);
            assert_eq!(output["additions"], 10_001);
            assert_eq!(output["hunks"].as_array().unwrap().len(), 1);
            assert_eq!(roundtrip(&before, &output), after);
        }
    }

    #[test]
    fn fallback_keeps_common_prefix_and_suffix_exact() {
        let cancel = || false;
        let head = (0..100).map(|i| format!("head {i}\n")).collect::<String>();
        let tail = (0..100).map(|i| format!("tail {i}\n")).collect::<String>();
        let before = format!("{head}{}{tail}", rewrite(3000, "a", "\n"));
        let after = format!("{head}{}{tail}", rewrite(3000, "b", "\n"));
        let output = parse(&preview_with_fallback(&before, &after, false, &cancel).unwrap());
        assert_eq!(output["approximate"], true);
        let hunks = output["hunks"].as_array().unwrap();
        assert_eq!(hunks.len(), 1);
        let hunk = &hunks[0];
        // Four lines of context on each side of the replaced span only.
        assert_eq!(hunk["oldStart"], 97);
        assert_eq!(hunk["newStart"], 97);
        assert_eq!(hunk["oldLines"], 3008);
        assert_eq!(hunk["newLines"], 3008);
        let lines = hunk["lines"].as_array().unwrap();
        assert_eq!(lines[0], " head 96");
        assert_eq!(lines[4], "-  const v0 = compute(0, \"a0\")");
        assert_eq!(lines[3004], "+  const v0 = compute(0, \"b0\")");
        assert_eq!(lines[lines.len() - 1], " tail 3");
        assert_eq!(output["additions"], 3000);
        assert_eq!(output["deletions"], 3000);
        assert_eq!(roundtrip(&before, &output), after);
    }

    #[test]
    fn fallback_anchors_sparse_edits_in_large_files() {
        let cancel = || false;
        let before = (0..50_000)
            .map(|i| format!("line {i}\n"))
            .collect::<String>();
        let after = (0..50_000)
            .map(|i| {
                if i % 50 == 25 {
                    format!("edited {i}\n")
                } else {
                    format!("line {i}\n")
                }
            })
            .collect::<String>();
        assert!(preview(&before, &after, false, &cancel).is_err());
        let output = parse(&preview_with_fallback(&before, &after, false, &cancel).unwrap());
        assert_eq!(output["approximate"], true);
        assert_eq!(output["hunks"].as_array().unwrap().len(), 1000);
        assert_eq!(output["additions"], 1000);
        assert_eq!(output["deletions"], 1000);
        assert_eq!(roundtrip(&before, &output), after);
    }

    #[test]
    fn inputs_within_budget_are_unchanged() {
        let cancel = || false;
        let mut fixtures = vec![
            (String::new(), String::new()),
            ("a".into(), "a\n".into()),
            ("a\r\nb".into(), "a\nb\n".into()),
            (rewrite(500, "a", "\n"), rewrite(500, "b", "\n")),
            (
                "x\n".repeat(5000),
                "x\n".repeat(4000) + "y\n" + &"x\n".repeat(1000),
            ),
        ];
        let mut seed = 17u32;
        let mut pick = |n: u32| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            seed % n
        };
        let words = ["a", "b", "", "中文", "😀", "\r"];
        for _ in 0..300 {
            let mut make = || {
                (0..pick(40))
                    .map(|_| {
                        words[pick(6) as usize].to_owned() + if pick(3) > 0 { "\n" } else { "\r\n" }
                    })
                    .collect::<String>()
            };
            fixtures.push((make(), make()));
        }
        for (before, after) in fixtures {
            for normalize in [false, true] {
                let exact = preview(&before, &after, normalize, &cancel).unwrap();
                assert!(!exact.contains("approximate"));
                assert_eq!(
                    preview_with_fallback(&before, &after, normalize, &cancel).unwrap(),
                    exact
                );
            }
        }
    }

    #[test]
    fn forced_fallback_roundtrips_random_edits() {
        let cancel = || false;
        let mut seed = 4242u32;
        let mut pick = |n: u32| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            seed % n
        };
        let words = ["a", "b", "c", "", "中文", "😀", "\r", "\0"];
        for i in 0..2000 {
            let mut make = || {
                let mut text = (0..pick(30))
                    .map(|_| {
                        words[pick(8) as usize].to_owned() + if pick(4) > 0 { "\n" } else { "\r\n" }
                    })
                    .collect::<String>();
                if pick(2) == 0 {
                    text.push_str("eof");
                }
                text
            };
            let (before, after) = (make(), make());
            // A tiny search budget forces the fallback on most inputs.
            let output = parse(&run(&before, &after, false, true, (i % 7) * 3, &cancel).unwrap());
            assert_eq!(
                roundtrip(&before, &output),
                after,
                "{before:?} -> {after:?}"
            );
            let normalized = parse(&run(&before, &after, true, true, i % 5, &cancel).unwrap());
            assert_eq!(
                roundtrip(&before.replace("\r\n", "\n"), &normalized),
                after.replace("\r\n", "\n")
            );
        }
    }

    #[test]
    fn fallback_keeps_byte_line_and_output_caps() {
        let cancel = || false;
        let reason = |result: Result<String>| result.unwrap_err().reason;
        assert!(
            reason(preview_with_fallback(
                &"\n".repeat(MAX_LINES + 1),
                "",
                false,
                &cancel
            ))
            .contains("limit")
        );
        let half = "x".repeat(MAX_BYTES / 2 + 1);
        assert!(reason(preview_with_fallback(&half, &half, false, &cancel)).contains("limit"));
        // A 2,000-line rewrite of 5 KiB lines exhausts the search; its coarse
        // preview would exceed the output cap, so it must still reject.
        let pad = "x".repeat(5 * 1024);
        let before = (0..2000)
            .map(|i| format!("a{i}{pad}\n"))
            .collect::<String>();
        let after = before.replace('a', "b");
        assert!(reason(preview_with_fallback(&before, &after, false, &cancel)).contains("limit"));
    }

    #[test]
    fn cancellation_rejects_during_search_and_fallback() {
        let before = rewrite(3000, "a", "\n");
        let after = rewrite(3000, "b", "\n");
        let calls = std::cell::Cell::new(0usize);
        let counting = || {
            calls.set(calls.get() + 1);
            false
        };
        assert!(
            parse(&preview_with_fallback(&before, &after, false, &counting).unwrap())["approximate"]
                == true
        );
        let total = calls.get();
        // Cancel at points spread through the exact search, the fallback and
        // hunk construction; none may publish a partial preview.
        for step in 1..=16 {
            let at = total * step / 17;
            let seen = std::cell::Cell::new(0usize);
            let cancel = || {
                seen.set(seen.get() + 1);
                seen.get() >= at
            };
            assert!(
                preview_with_fallback(&before, &after, false, &cancel)
                    .unwrap_err()
                    .reason
                    .contains("cancelled")
            );
        }
    }
}
