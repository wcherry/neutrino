// src/shared/collab_protocol.rs
//
// Shared y-websocket-compatible varint codec used by all WebSocket handlers.

/// Write an unsigned 64-bit integer as a variable-length integer into `buf`.
pub fn write_varint(buf: &mut Vec<u8>, mut n: u64) {
    loop {
        let byte = (n & 0x7F) as u8;
        n >>= 7;
        if n == 0 {
            buf.push(byte);
            break;
        } else {
            buf.push(byte | 0x80);
        }
    }
}

/// Read a variable-length integer from `data`.
///
/// Returns `Some((value, bytes_consumed))` or `None` if the data is truncated
/// or the encoded value overflows 64 bits.
pub fn read_varint(data: &[u8]) -> Option<(u64, usize)> {
    let mut result = 0u64;
    let mut shift = 0u32;
    let mut consumed = 0usize;
    for &byte in data {
        consumed += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((result, consumed));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

/// Write a length-prefixed byte slice into `buf`.
pub fn write_var_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    write_varint(buf, bytes.len() as u64);
    buf.extend_from_slice(bytes);
}

/// Read a length-prefixed byte slice from `data`.
///
/// Returns `Some((&slice, bytes_consumed))` or `None` if the data is truncated.
pub fn read_var_bytes(data: &[u8]) -> Option<(&[u8], usize)> {
    let (len, header_len) = read_varint(data)?;
    let end = header_len + len as usize;
    if end > data.len() {
        return None;
    }
    Some((&data[header_len..end], end))
}
