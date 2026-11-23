//! Dedicated native and Wasm ABI for the AX TUI width experiment.

#![cfg_attr(
    all(target_env = "musl", panic = "abort", not(debug_assertions), not(test)),
    no_std
)]

mod width;

use core::sync::atomic::{AtomicBool, Ordering};
use width::WidthMethod;

#[cfg(all(target_env = "musl", panic = "abort", not(debug_assertions), not(test)))]
mod musl_release {
    #[link(name = "c")]
    unsafe extern "C" {
        fn abort() -> !;
    }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
        // SAFETY: The musl C runtime supplies abort, which never returns.
        unsafe { abort() }
    }
}

const BYTE_CAPACITY: u32 = 1024 * 1024;
const ITEM_CAPACITY: u32 = 4096;
// ABI 2 requires callers to acquire the lease before accessing the buffers.
const ABI_VERSION: u32 = 2;

const OK: u32 = 0;
const INVALID_OPTIONS: u32 = 1;
const INVALID_RANGE: u32 = 2;
const INVALID_UTF8: u32 = 3;
const WORK_LIMIT_EXCEEDED: u32 = 4;

static LEASED: AtomicBool = AtomicBool::new(false);
static mut INPUT: [u8; BYTE_CAPACITY as usize] = [0; BYTE_CAPACITY as usize];
static mut RANGES: [[u32; 2]; ITEM_CAPACITY as usize] = [[0; 2]; ITEM_CAPACITY as usize];
static mut WIDTHS: [u32; ITEM_CAPACITY as usize] = [0; ITEM_CAPACITY as usize];

#[unsafe(no_mangle)]
pub extern "C" fn kernelAbiVersion() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn kernelByteCapacity() -> u32 {
    BYTE_CAPACITY
}

#[unsafe(no_mangle)]
pub extern "C" fn kernelItemCapacity() -> u32 {
    ITEM_CAPACITY
}

/// Acquire exclusive use of the buffers for this loaded library or Wasm instance.
#[unsafe(no_mangle)]
pub extern "C" fn kernelAcquire() -> u32 {
    u32::from(
        LEASED
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_ok(),
    )
}

/// Release the buffers.
///
/// # Safety
/// Only the current holder may release. No caller may access the buffers after release.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn kernelRelease() {
    LEASED.store(false, Ordering::Release);
}

/// Return the input buffer. Only the lease holder may dereference it.
#[unsafe(no_mangle)]
pub extern "C" fn kernelInput() -> *mut u8 {
    (&raw mut INPUT).cast()
}

/// Return the range buffer. Only the lease holder may dereference it.
#[unsafe(no_mangle)]
pub extern "C" fn kernelRanges() -> *mut u32 {
    (&raw mut RANGES).cast()
}

/// Return the widths buffer. Only the lease holder may read it.
#[unsafe(no_mangle)]
pub extern "C" fn kernelWidths() -> *const u32 {
    (&raw const WIDTHS).cast()
}

/// Validate and measure one batch while holding the exclusive lease.
///
/// # Safety
/// Only the lease holder may call this function. Callers may access the exported
/// buffers before or after this call, with no concurrent accesses during the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn kernelMeasure(
    count: u32,
    byte_length: u32,
    tab_width: u32,
    method: u32,
) -> u32 {
    let method = match method {
        0 => WidthMethod::Unicode,
        1 => WidthMethod::Wcwidth,
        2 => WidthMethod::NoZwj,
        _ => return INVALID_OPTIONS,
    };
    if count > ITEM_CAPACITY
        || byte_length > BYTE_CAPACITY
        || !(1..=255).contains(&tab_width)
        || !LEASED.load(Ordering::Relaxed)
    {
        return INVALID_OPTIONS;
    }

    // SAFETY: These distinct arrays are live for the module lifetime. The lease
    // excludes another owner, and the validated lengths fit each array.
    let (input, ranges, widths) = unsafe {
        (
            core::slice::from_raw_parts(kernelInput(), byte_length as usize),
            core::slice::from_raw_parts((&raw const RANGES).cast(), count as usize),
            core::slice::from_raw_parts_mut((&raw mut WIDTHS).cast(), count as usize),
        )
    };
    measure_batch(input, ranges, widths, tab_width, method)
}

fn measure_batch(
    input: &[u8],
    ranges: &[[u32; 2]],
    widths: &mut [u32],
    tab_width: u32,
    method: WidthMethod,
) -> u32 {
    let mut bytes_remaining = BYTE_CAPACITY;
    for &[offset, length] in ranges {
        let Some(end) = offset.checked_add(length) else {
            return INVALID_RANGE;
        };
        let Some(bytes) = input.get(offset as usize..end as usize) else {
            return INVALID_RANGE;
        };
        let Some(remaining) = bytes_remaining.checked_sub(length) else {
            return WORK_LIMIT_EXCEEDED;
        };
        bytes_remaining = remaining;
        if core::str::from_utf8(bytes).is_err() {
            return INVALID_UTF8;
        }
    }
    for (&[offset, length], result) in ranges.iter().zip(widths) {
        // SAFETY: The first pass validated the same immutable byte slices.
        let text = unsafe {
            core::str::from_utf8_unchecked(&input[offset as usize..(offset + length) as usize])
        };
        *result = width::measure(text, tab_width, method);
    }
    OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_suffix_preserves_every_width() {
        for (range, expected) in [
            ([u32::MAX, 1], INVALID_RANGE),
            ([2, 3], INVALID_RANGE),
            ([2, 1], INVALID_UTF8),
        ] {
            let mut widths = [42, 89];
            assert_eq!(
                measure_batch(
                    "a中".as_bytes(),
                    &[[0, 1], range],
                    &mut widths,
                    4,
                    WidthMethod::Unicode
                ),
                expected
            );
            assert_eq!(widths, [42, 89]);
        }
    }

    #[test]
    fn work_budget_counts_overlapping_ranges_before_publishing_widths() {
        let input = vec![b'a'; BYTE_CAPACITY as usize];
        let mut widths = [42, 89];
        assert_eq!(
            measure_batch(
                &input,
                &[[0, BYTE_CAPACITY], [0, 1]],
                &mut widths,
                4,
                WidthMethod::Unicode
            ),
            WORK_LIMIT_EXCEEDED
        );
        assert_eq!(widths, [42, 89]);
        assert_eq!(
            measure_batch(
                &input,
                &[[0, BYTE_CAPACITY - 1], [0, 1]],
                &mut widths,
                4,
                WidthMethod::Unicode
            ),
            OK
        );
        assert_eq!(widths, [BYTE_CAPACITY - 1, 1]);
    }

    #[test]
    fn one_owner_per_loaded_library() {
        assert_eq!(kernelAcquire(), 1);
        assert_eq!(
            std::thread::spawn(|| kernelAcquire())
                .join()
                .expect("test thread"),
            0
        );
        // SAFETY: This test acquired the only lease and has no active buffer accesses.
        unsafe { kernelRelease() };
        assert_eq!(kernelAcquire(), 1);
        // SAFETY: This test owns the newly acquired lease.
        unsafe { kernelRelease() };
    }
}
