//! Shared guards for the OpenTUI-compatible FFI boundary.
//!
//! The JavaScript bridge represents native addresses as `f64` numbers. That is
//! only sound while the value is a finite, non-negative, integral IEEE-754 safe
//! integer. Rejecting invalid numbers at the boundary prevents NaN/Inf/negative
//! values from being cast into arbitrary raw pointers.

use crate::buffer::Rgba;

const MAX_EXACT_JS_INTEGER: usize = 9_007_199_254_740_991;
const MAX_FFI_RECORDS: usize = 1_000_000;

#[inline]
pub(crate) fn addr_from_f64(value: f64) -> Option<usize> {
    if !value.is_finite() || value <= 0.0 || value.fract() != 0.0 {
        return None;
    }
    if value > MAX_EXACT_JS_INTEGER as f64 {
        return None;
    }
    let addr = value as usize;
    (addr != 0).then_some(addr)
}

#[inline]
pub(crate) fn addr_to_f64(addr: usize) -> f64 {
    if addr == 0 || addr > MAX_EXACT_JS_INTEGER {
        return 0.0;
    }
    addr as f64
}

#[inline]
pub(crate) fn byte_len_from_u32(len: u32) -> Option<usize> {
    let len = len as usize;
    (len <= isize::MAX as usize).then_some(len)
}

#[inline]
pub(crate) fn record_count(count: u32) -> Option<usize> {
    let count = count as usize;
    (count <= MAX_FFI_RECORDS).then_some(count)
}

#[inline]
pub(crate) fn checked_offset(base: usize, offset: usize) -> Option<usize> {
    base.checked_add(offset)
}

#[inline]
pub(crate) fn checked_record_addr(base: usize, index: usize, stride: usize) -> Option<usize> {
    index.checked_mul(stride).and_then(|offset| base.checked_add(offset))
}

#[inline]
pub(crate) fn len_to_u32(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

#[inline]
fn slice_byte_len<T>(len: usize) -> Option<usize> {
    len.checked_mul(std::mem::size_of::<T>())
        .filter(|bytes| *bytes <= isize::MAX as usize)
}

#[inline]
pub(crate) unsafe fn bytes_from_addr<'a>(addr: usize, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        return Some(&[]);
    }
    if addr == 0 || len > isize::MAX as usize {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(addr as *const u8, len) })
}

#[inline]
pub(crate) unsafe fn bytes_from_f64<'a>(ptr: f64, len: u32) -> Option<&'a [u8]> {
    let len = byte_len_from_u32(len)?;
    if len == 0 {
        return Some(&[]);
    }
    let addr = addr_from_f64(ptr)?;
    unsafe { bytes_from_addr(addr, len) }
}

#[inline]
pub(crate) unsafe fn slice_from_f64<'a, T>(ptr: f64, len: usize) -> Option<&'a [T]> {
    if len == 0 {
        return Some(&[]);
    }
    let addr = addr_from_f64(ptr)?;
    if addr % std::mem::align_of::<T>() != 0 {
        return None;
    }
    slice_byte_len::<T>(len)?;
    Some(unsafe { std::slice::from_raw_parts(addr as *const T, len) })
}

#[inline]
pub(crate) unsafe fn slice_mut_from_f64<'a, T>(ptr: f64, len: usize) -> Option<&'a mut [T]> {
    if len == 0 {
        return Some(&mut []);
    }
    let addr = addr_from_f64(ptr)?;
    if addr % std::mem::align_of::<T>() != 0 {
        return None;
    }
    slice_byte_len::<T>(len)?;
    Some(unsafe { std::slice::from_raw_parts_mut(addr as *mut T, len) })
}

#[inline]
pub(crate) fn read_unaligned_addr<T: Copy>(addr: usize) -> Option<T> {
    (addr != 0).then(|| unsafe { std::ptr::read_unaligned(addr as *const T) })
}

#[inline]
pub(crate) fn read_unaligned_f64<T: Copy>(ptr: f64) -> Option<T> {
    read_unaligned_addr(addr_from_f64(ptr)?)
}

#[inline]
pub(crate) fn write_unaligned_addr<T: Copy>(addr: usize, value: T) -> bool {
    if addr == 0 {
        return false;
    }
    unsafe { std::ptr::write_unaligned(addr as *mut T, value) };
    true
}

#[inline]
pub(crate) fn write_unaligned_f64<T: Copy>(ptr: f64, value: T) -> bool {
    let Some(addr) = addr_from_f64(ptr) else {
        return false;
    };
    write_unaligned_addr(addr, value)
}

#[inline]
pub(crate) fn read_rgba_addr(addr: usize) -> Option<Rgba> {
    let r = read_unaligned_addr::<u16>(addr)?;
    let g = read_unaligned_addr::<u16>(checked_offset(addr, 2)?)?;
    let b = read_unaligned_addr::<u16>(checked_offset(addr, 4)?)?;
    let a = read_unaligned_addr::<u16>(checked_offset(addr, 6)?)?;
    Some([r, g, b, a])
}

#[inline]
pub(crate) fn read_rgba_f64(ptr: f64) -> Option<Rgba> {
    read_rgba_addr(addr_from_f64(ptr)?)
}

#[inline]
pub(crate) fn copy_raw_to_f64(src: *const u8, src_len: usize, out_ptr: f64, max_len: u32) -> u32 {
    if src.is_null() || src_len == 0 || max_len == 0 {
        return 0;
    }
    let Some(out_addr) = addr_from_f64(out_ptr) else {
        return 0;
    };
    let Some(max_len) = byte_len_from_u32(max_len) else {
        return 0;
    };
    let copy = src_len.min(max_len);
    unsafe { std::ptr::copy_nonoverlapping(src, out_addr as *mut u8, copy) };
    len_to_u32(copy)
}

#[inline]
pub(crate) fn copy_bytes_to_f64(bytes: &[u8], out_ptr: f64, max_len: u32) -> u32 {
    copy_raw_to_f64(bytes.as_ptr(), bytes.len(), out_ptr, max_len)
}
