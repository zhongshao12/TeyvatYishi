use serde_json::Value;
use std::sync::OnceLock;

fn schemas() -> &'static Value {
    static SCHEMAS: OnceLock<Value> = OnceLock::new();
    SCHEMAS.get_or_init(|| {
        serde_json::from_str(include_str!("../../core/contracts/nativeSchemas.json"))
            .expect("compiled native schema must be checked before shipping")
    })
}
fn number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}
fn nat(value: &Value) -> bool {
    number(value).is_some_and(|n| (0.0..=9_007_199_254_740_991.0).contains(&n) && n.fract() == 0.0)
}
fn id(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        !text.is_empty()
            && text.len() <= 160
            && text.as_bytes()[0].is_ascii_alphanumeric()
            && text
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-'))
    })
}
pub(crate) fn js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{b}' | '\u{c}' | '\u{20}' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
                | '\n'
                | '\r'
                | '\u{2028}'
                | '\u{2029}'
    )
}
pub(crate) fn non_empty_text(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|text| !text.trim_matches(js_whitespace).is_empty())
}
fn same_scope(a: &Value, b: &Value) -> bool {
    a["journeyId"] == b["journeyId"] && a["branchId"] == b["branchId"]
}
fn rule(name: &str, value: &Value) -> bool {
    match name {
        "head" => {
            if let Some(parent) = value.get("parent") {
                nat(&value["forkSeq"])
                    && nat(&value["forkMemoryRevision"])
                    && number(&value["coreSeq"]) >= number(&value["forkSeq"])
                    && number(&value["memoryRevision"]) >= number(&value["forkMemoryRevision"])
                    && parent["journeyId"] == value["scope"]["journeyId"]
                    && parent["branchId"] != value["scope"]["branchId"]
            } else {
                value.get("forkSeq").is_none() && value.get("forkMemoryRevision").is_none()
            }
        }
        "evidence" => number(&value["end"])
            .zip(number(&value["start"]))
            .is_some_and(|(end, start)| {
                end > start
                    && end - start
                        == value["quote"]
                            .as_str()
                            .map_or(0, |text| text.encode_utf16().count())
                            as f64
            }),
        "candidate" => value["kind"] == value["proposal"]["kind"],
        "memory" => ["sourceRefs", "eventIds", "memoryRefs"]
            .iter()
            .any(|key| value[*key].as_array().is_some_and(|refs| !refs.is_empty())),
        "jobStep" => {
            if value["status"] == "failed" {
                value.get("failure").is_some()
                    && value["memories"].as_array().is_some_and(Vec::is_empty)
            } else {
                value.get("failure").is_none()
            }
        }
        "jobFinish" => {
            if value["status"] == "failed" {
                value.get("failure").is_some()
            } else {
                value["status"] != "completed" || value.get("failure").is_none()
            }
        }
        "snapshotRecord" => {
            number(&value["coreSeq"]) == number(&value["state"]["head"]["coreSeq"])
                && number(&value["memoryRevision"])
                    == number(&value["state"]["head"]["memoryRevision"])
        }
        _ => false,
    }
}
fn check(schema: &Value, value: Option<&Value>, depth: usize) -> bool {
    if depth > 200 {
        return false;
    }
    let kind = schema["kind"].as_str().unwrap_or("");
    if kind == "optional" {
        return value.is_none() || check(&schema["item"], value, depth + 1);
    }
    if kind == "ref" {
        return schema["name"]
            .as_str()
            .and_then(|name| schemas()["checks"].get(name))
            .is_some_and(|schema| check(schema, value, depth + 1));
    }
    let Some(value) = value else {
        return false;
    };
    match kind {
        "any" => true,
        "text" => value.is_string(),
        "nonEmpty" => non_empty_text(value),
        "id" => id(value),
        "finite" => number(value).is_some(),
        "nat" => nat(value),
        "positive" => nat(value) && number(value).is_some_and(|n| n > 0.0),
        "bool" => value.is_boolean(),
        "imageLink" => value.as_str().is_some_and(|text| {
            !text.to_ascii_lowercase().starts_with("data:")
                && !text.to_ascii_lowercase().starts_with("blob:")
        }),
        "one" => schema["values"].as_array().is_some_and(|values| {
            values
                .iter()
                .any(|allowed| match (number(allowed), number(value)) {
                    (Some(a), Some(b)) => a == b,
                    _ => allowed == value,
                })
        }),
        "nullable" => value.is_null() || check(&schema["item"], Some(value), depth + 1),
        "or" => schema["items"].as_array().is_some_and(|schemas| {
            schemas
                .iter()
                .any(|schema| check(schema, Some(value), depth + 1))
        }),
        "list" => value.as_array().is_some_and(|items| {
            schema["min"]
                .as_u64()
                .is_some_and(|min| items.len() as u64 >= min)
                && items
                    .iter()
                    .all(|value| check(&schema["item"], Some(value), depth + 1))
        }),
        "dictionary" => value.as_object().is_some_and(|items| {
            items
                .values()
                .all(|value| check(&schema["item"], Some(value), depth + 1))
        }),
        "bounded" => {
            check(&schema["item"], Some(value), depth + 1)
                && number(value)
                    .zip(number(&schema["max"]))
                    .is_some_and(|(n, max)| n <= max)
        }
        "object" => value
            .as_object()
            .zip(schema["fields"].as_object())
            .is_some_and(|(values, fields)| {
                values.keys().all(|key| fields.contains_key(key))
                    && fields
                        .iter()
                        .all(|(key, schema)| check(schema, values.get(key), depth + 1))
            }),
        "switch" => schema["field"]
            .as_str()
            .and_then(|field| value.get(field))
            .and_then(Value::as_str)
            .and_then(|case| schema["cases"].get(case))
            .is_some_and(|schema| check(schema, Some(value), depth + 1)),
        "rule" => {
            check(&schema["base"], Some(value), depth + 1)
                && schema["name"]
                    .as_str()
                    .is_some_and(|name| rule(name, value))
        }
        _ => false,
    }
}
fn scope_consistent(value: &Value, expected: &Value, root_head: bool) -> bool {
    match value {
        Value::Object(fields) => {
            if fields
                .get("scope")
                .is_some_and(|scope| !same_scope(scope, expected))
                || fields
                    .get("journeyId")
                    .is_some_and(|id| id != &expected["journeyId"])
                || fields
                    .get("branchId")
                    .is_some_and(|id| id != &expected["branchId"])
            {
                return false;
            }
            fields.iter().all(|(key, child)| {
                key == "head"
                    || (root_head && key == "parent")
                    || scope_consistent(child, expected, false)
            })
        }
        Value::Array(values) => values
            .iter()
            .all(|value| scope_consistent(value, expected, false)),
        _ => true,
    }
}
pub(crate) fn validate_core_dto(kind: &str, value: &Value) -> bool {
    if crate::core2_json::stable_json(value).is_err()
        || !schemas()["checks"]
            .get(kind)
            .is_some_and(|schema| check(schema, Some(value), 0))
    {
        return false;
    }
    let expected = if value["head"].is_object() {
        Some(&value["head"]["scope"])
    } else {
        value.get("scope")
    };
    if let Some(scope) = expected {
        return scope_consistent(value, scope, kind == "head");
    }
    if id(&value["journeyId"]) && id(&value["branchId"]) {
        let scope =
            serde_json::json!({"journeyId":value["journeyId"],"branchId":value["branchId"]});
        return scope_consistent(value, &scope, false);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_whitelist_matches_the_independent_frontend_contract_corpus() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../tests/fixtures/core2-native-contract-corpus.json"
        ))
        .unwrap();
        for (index, case) in cases.iter().enumerate() {
            let kind = case["kind"].as_str().unwrap();
            assert_eq!(
                validate_core_dto(kind, &case["input"]),
                case["accepted"].as_bool().unwrap(),
                "case {index}: {kind}"
            );
        }
    }
    #[test]
    fn native_whitelist_does_not_accept_unknown_kinds_or_poisoned_json() {
        assert!(!validate_core_dto("not-registered", &serde_json::json!({})));
        assert!(!validate_core_dto(
            "scope",
            &serde_json::json!({"journeyId":"a","branchId":"b","constructor":{}})
        ));
        assert!(!validate_core_dto(
            "scope",
            &serde_json::json!({"journeyId":"a","branchId":null})
        ));
    }
    #[test]
    fn native_numeric_checks_use_javascript_value_equality_not_json_token_forms() {
        let input: Value = serde_json::from_str(r#"{"snapshotId":"snapshot","scope":{"journeyId":"a","branchId":"b"},"coreSeq":1.0,"memoryRevision":0,"state":{"head":{"scope":{"journeyId":"a","branchId":"b"},"coreSeq":1,"memoryRevision":0.0,"sessionId":"session"},"records":[],"contentRefs":[]},"createdAt":0,"checksum":"test"}"#).unwrap();
        assert!(validate_core_dto("snapshotRecord", &input));
    }
}
