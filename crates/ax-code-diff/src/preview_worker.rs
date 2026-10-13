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
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_LINES: usize = 200_000;
const MAX_COMPONENTS: usize = 1_000_000;
const MAX_WORK: usize = 8_000_000;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;

#[napi]
pub struct DiffCancellation {
    cancelled: Arc<AtomicBool>,
}
#[napi]
impl DiffCancellation {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

fn check(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        return Err(napi::Error::from_reason("Native diff cancelled"));
    }
    Ok(())
}
fn limit() -> napi::Error {
    napi::Error::from_reason("Diff resource limit exceeded; split the edit into smaller changes")
}

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

fn push(arena: &mut Vec<Component>, path: &mut Path, kind: Kind, count: usize) -> Result<()> {
    if count == 0 {
        return Ok(());
    }
    if arena.len() >= MAX_COMPONENTS {
        return Err(limit());
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
    cancel: &'a AtomicBool,
    work: usize,
}
impl Budget<'_> {
    fn tick(&mut self) -> Result<()> {
        self.work += 1;
        if self.work > MAX_WORK {
            return Err(limit());
        }
        check(self.cancel)
    }
}

fn common(
    path: &mut Path,
    diagonal: isize,
    old: &[&str],
    new: &[&str],
    arena: &mut Vec<Component>,
    budget: &mut Budget,
) -> Result<isize> {
    let mut pos = path.old - diagonal;
    let mut count = 0;
    while path.old + 1 < old.len() as isize && pos + 1 < new.len() as isize {
        budget.tick()?;
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

fn components(old: &[&str], new: &[&str], budget: &mut Budget) -> Result<Vec<Component>> {
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
            budget.tick()?;
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
    let mut last = done.ok_or_else(limit)?.last;
    let mut result = Vec::new();
    while let Some(i) = last {
        budget.tick()?;
        result.push(arena[i]);
        last = arena[i].previous;
    }
    result.reverse();
    Ok(result)
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

fn preview(old: &str, new: &str, normalize: bool, cancel: &AtomicBool) -> Result<String> {
    check(cancel)?;
    if old.len() + new.len() > MAX_BYTES {
        return Err(limit());
    }
    let mut budget = Budget { cancel, work: 0 };
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
    let changes = components(&old_lines, &new_lines, &mut budget)?;
    let hunks = hunks(&old_lines, &new_lines, &changes, &mut budget)?;
    let (additions, deletions) = if needs_normalize {
        counts(&components(
            &tokens(old, &mut budget)?,
            &tokens(new, &mut budget)?,
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
    })
    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    if result.len() > MAX_OUTPUT {
        return Err(limit());
    }
    check(cancel)?;
    Ok(result)
}

pub struct DiffTask {
    old: String,
    new: String,
    normalize: bool,
    cancel: Arc<AtomicBool>,
}
impl Task for DiffTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        preview(&self.old, &self.new, self.normalize, &self.cancel)
    }
    fn resolve(&mut self, _: Env, output: String) -> Result<String> {
        check(&self.cancel)?;
        Ok(output)
    }
}
#[napi(ts_return_type = "Promise<string>")]
pub fn diff_preview_async(
    before: String,
    after: String,
    normalize: bool,
    cancellation: &DiffCancellation,
) -> AsyncTask<DiffTask> {
    AsyncTask::new(DiffTask {
        old: before,
        new: after,
        normalize,
        cancel: cancellation.cancelled.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_newline_cancel_and_budgets() {
        let cancel = AtomicBool::new(false);
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
        cancel.store(true, Ordering::Relaxed);
        assert!(
            preview("a", "b", false, &cancel)
                .unwrap_err()
                .reason
                .contains("cancelled")
        );
    }
}
