//! IPC encodes bytes losslessly, while the filesystem stores raw immutable blocks.
use crate::core2_json::stable_json;
use crate::core2_repository::{assert_id, checked, same, text, CoreFileTransaction};
use crate::core2_store::{checksum_bytes, BlockRef};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::path::Path;

fn exact_fields(value: &Value, fields: &[&str], error: &str) -> Result<(), String> {
    stable_json(value).map_err(|_| error)?;
    let object = value.as_object().ok_or(error)?;
    if object.len() != fields.len() || !fields.iter().all(|field| object.contains_key(*field)) {
        return Err(error.into());
    }
    Ok(())
}
pub(crate) fn checked_asset(asset: &Value) -> Result<Vec<u8>, String> {
    exact_fields(
        asset,
        &["assetId", "scope", "mimeType", "bytesBase64", "checksum"],
        "CORE2_INVALID_ASSET",
    )?;
    assert_id(text(&asset["assetId"]).map_err(|_| "CORE2_INVALID_ASSET")?)?;
    checked("scope", &asset["scope"])?;
    let mime = text(&asset["mimeType"]).map_err(|_| "CORE2_INVALID_ASSET")?;
    let parts: Vec<_> = mime.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.as_bytes()[0].is_ascii_alphanumeric()
                || !part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"!#$&^_.+-".contains(&b))
        })
    {
        return Err("CORE2_INVALID_ASSET".into());
    }
    let checksum = text(&asset["checksum"]).map_err(|_| "CORE2_INVALID_ASSET")?;
    if checksum.len() != 16
        || !checksum
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("CORE2_INVALID_ASSET".into());
    }
    let bytes = STANDARD
        .decode(text(&asset["bytesBase64"]).map_err(|_| "CORE2_INVALID_ASSET")?)
        .map_err(|_| "CORE2_INVALID_ASSET")?;
    if bytes.is_empty() {
        return Err("CORE2_INVALID_ASSET".into());
    }
    if checksum_bytes(&bytes) != checksum {
        return Err("CORE2_ASSET_CHECKSUM_MISMATCH".into());
    }
    Ok(bytes)
}
pub(crate) fn asset_from_transaction(tx: &CoreFileTransaction, id: &str) -> Result<Value, String> {
    let Some(stored) = tx.get("assets", id)? else {
        return Ok(Value::Null);
    };
    let reference: BlockRef = serde_json::from_value(stored["block"].clone())
        .map_err(|_| "CORE2_CORRUPT_ASSET_REFERENCE")?;
    let bytes = tx.read_binary(&reference)?;
    let mut asset = stored["asset"].clone();
    asset["bytesBase64"] = json!(STANDARD.encode(&bytes));
    checked_asset(&asset)?;
    if asset["assetId"] != id {
        return Err("CORE2_CORRUPT_ASSET_ID".into());
    }
    Ok(asset)
}
pub(crate) fn read_asset(root: &Path, id: String) -> Result<Value, String> {
    assert_id(&id)?;
    asset_from_transaction(&CoreFileTransaction::open(root)?, &id)
}
pub(crate) fn publish_asset(root: &Path, publication: Value) -> Result<(), String> {
    exact_fields(
        &publication,
        &["scope", "sessionId", "asset"],
        "CORE2_INVALID_ASSET_PUBLICATION",
    )?;
    checked("scope", &publication["scope"])?;
    assert_id(text(&publication["sessionId"]).map_err(|_| "CORE2_INVALID_ASSET_PUBLICATION")?)?;
    let bytes = checked_asset(&publication["asset"])?;
    if !same(&publication["scope"], &publication["asset"]["scope"]) {
        return Err("CORE2_INVALID_ASSET_PUBLICATION".into());
    }
    let mut tx = CoreFileTransaction::open(root)?;
    if tx.branch(&publication["scope"])?["head"]["sessionId"] != publication["sessionId"] {
        return Err("CORE2_SESSION_CHANGED".into());
    }
    let asset = &publication["asset"];
    let id = text(&asset["assetId"])?;
    let previous = asset_from_transaction(&tx, id)?;
    if !previous.is_null() {
        // Equality compares actual bytes as well as metadata; the checksum is not an identity proof.
        if !same(&previous, asset) {
            return Err("CORE2_ASSET_IMMUTABLE".into());
        }
        return Ok(());
    }
    let block = tx.write_binary(&bytes)?;
    let mut metadata = asset.clone();
    metadata.as_object_mut().unwrap().remove("bytesBase64");
    tx.add("assets", id.into(), json!({"asset":metadata,"block":block}))?;
    tx.finish()
}
