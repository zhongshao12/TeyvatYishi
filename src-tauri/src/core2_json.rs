use serde_json::Value;

/// Canonical JSON at the native boundary; the wire uses JavaScript number semantics.
pub(crate) fn stable_json(value: &Value) -> Result<String, String> {
    fn encode(value: &Value, depth: usize) -> Result<String, String> {
        if depth > 64 {
            return Err("CORE2_INVALID_JSON_DEPTH".into());
        }
        match value {
            Value::Null => Ok("null".into()),
            Value::Bool(value) => Ok(value.to_string()),
            Value::Number(value) => js_number(value.as_f64().ok_or("CORE2_INVALID_JSON_NUMBER")?),
            Value::String(value) => {
                serde_json::to_string(value).map_err(|e| format!("CORE2_INVALID_JSON: {e}"))
            }
            Value::Array(values) => Ok(format!(
                "[{}]",
                values
                    .iter()
                    .map(|v| encode(v, depth + 1))
                    .collect::<Result<Vec<_>, _>>()?
                    .join(",")
            )),
            Value::Object(values) => {
                let mut keys: Vec<_> = values.keys().collect();
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                let mut fields = Vec::new();
                for key in keys {
                    if matches!(key.as_str(), "__proto__" | "prototype" | "constructor") {
                        return Err("CORE2_INVALID_JSON_KEY".into());
                    }
                    let key_json = serde_json::to_string(key)
                        .map_err(|e| format!("CORE2_INVALID_JSON: {e}"))?;
                    fields.push(format!("{key_json}:{}", encode(&values[key], depth + 1)?));
                }
                Ok(format!("{{{}}}", fields.join(",")))
            }
        }
    }
    encode(value, 0)
}

fn js_number(value: f64) -> Result<String, String> {
    if !value.is_finite() {
        return Err("CORE2_INVALID_JSON_NUMBER".into());
    }
    if value == 0.0 {
        return Ok("0".into());
    }
    let sign = if value.is_sign_negative() { "-" } else { "" };
    let shortest = value.abs().to_string();
    let (mantissa, exponent) = match shortest.split_once('e') {
        Some((mantissa, exponent)) => (
            mantissa,
            exponent
                .parse::<i32>()
                .map_err(|_| "CORE2_INVALID_JSON_NUMBER")?,
        ),
        None => (shortest.as_str(), 0),
    };
    let mut position = mantissa.find('.').unwrap_or(mantissa.len()) as i32 + exponent;
    let mut digits = mantissa.replace('.', "");
    let leading = digits.bytes().take_while(|byte| *byte == b'0').count();
    position -= leading as i32;
    digits.drain(..leading);
    while digits.ends_with('0') {
        digits.pop();
    }
    // Rust Display may choose the other decimal at an exact midpoint. ECMAScript
    // chooses an even final significand. Compare exact binary factors, not f64
    // subtraction (both candidates round back to this same binary value).
    let decimal_power = position - digits.len() as i32;
    let bits = value.abs().to_bits();
    let exponent_bits = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = (bits & ((1u64 << 52) - 1)) | if exponent_bits == 0 { 0 } else { 1u64 << 52 };
    let binary_power = if exponent_bits == 0 {
        -1074
    } else {
        exponent_bits - 1023 - 52
    };
    let mut denominator_divides = true;
    let mut reduced = mantissa;
    if decimal_power > 0 {
        for _ in 0..decimal_power {
            if reduced % 5 != 0 {
                denominator_divides = false;
                break;
            }
            reduced /= 5;
        }
    }
    if denominator_divides
        && binary_power + 1 - decimal_power + mantissa.trailing_zeros() as i32 == 0
    {
        let significand = digits
            .parse::<u64>()
            .map_err(|_| "CORE2_INVALID_JSON_NUMBER")?;
        if significand % 2 != 0 {
            for candidate in [significand.saturating_sub(1), significand + 1] {
                if format!("{candidate}e{decimal_power}")
                    .parse::<f64>()
                    .is_ok_and(|number| number.to_bits() == bits)
                {
                    digits = candidate.to_string();
                    position = digits.len() as i32 + decimal_power;
                    while digits.ends_with('0') {
                        digits.pop();
                    }
                    break;
                }
            }
        }
    }
    let power = position - 1;
    let encoded = if !(-6..21).contains(&power) {
        let fraction = if digits.len() > 1 {
            format!(".{}", &digits[1..])
        } else {
            String::new()
        };
        format!(
            "{}{fraction}e{}{power}",
            &digits[..1],
            if power >= 0 { "+" } else { "" }
        )
    } else if position <= 0 {
        format!("0.{}{digits}", "0".repeat((-position) as usize))
    } else if position as usize >= digits.len() {
        format!("{digits}{}", "0".repeat(position as usize - digits.len()))
    } else {
        format!(
            "{}.{}",
            &digits[..position as usize],
            &digits[position as usize..]
        )
    };
    Ok(format!("{sign}{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_json_matches_independent_node_ieee754_goldens() {
        let cases: Vec<(String, String)> =
            serde_json::from_str(include_str!("../../tests/fixtures/core2-js-numbers.json"))
                .unwrap();
        for (input, expected) in cases {
            let parsed: Value = serde_json::from_str(&input).unwrap();
            assert_eq!(
                parsed.as_f64().unwrap().to_bits(),
                input.parse::<f64>().unwrap().to_bits(),
                "JSON parser rounded differently: {input}"
            );
            assert_eq!(stable_json(&parsed).unwrap(), expected, "input {input}");
        }
    }
    #[test]
    fn canonical_json_matches_js_numeric_boundaries() {
        for (input, expected) in [
            ("-0.0", "0"),
            ("1.0", "1"),
            ("1e-7", "1e-7"),
            ("1e-6", "0.000001"),
            ("1e20", "100000000000000000000"),
            ("1e21", "1e+21"),
            ("-1.23e21", "-1.23e+21"),
            ("1.2345e-5", "0.000012345"),
            ("1000000000000000100", "1000000000000000100"),
            ("1381472817847324.25", "1381472817847324.2"),
        ] {
            assert_eq!(
                stable_json(&serde_json::from_str(input).unwrap()).unwrap(),
                expected,
                "{input}"
            );
        }
    }
    #[test]
    fn canonical_json_sorts_keys_by_utf16_without_reordering_numeric_keys() {
        let input: Value = serde_json::from_str(
            r#"{"2":"two","10":"ten","\ue000":"private","😀":"emoji","a":{"2":2,"10":10}}"#,
        )
        .unwrap();
        let expected = "{\"10\":\"ten\",\"2\":\"two\",\"a\":{\"10\":10,\"2\":2},\"😀\":\"emoji\",\"\u{e000}\":\"private\"}";
        assert_eq!(stable_json(&input).unwrap(), expected);
    }
    #[test]
    fn canonical_json_rejects_unsafe_json_keys_and_excessive_depth() {
        for input in [
            r#"{"constructor":0}"#,
            r#"{"a":[{"__proto__":{}}]}"#,
            r#"{"prototype":[]}"#,
        ] {
            assert!(stable_json(&serde_json::from_str(input).unwrap()).is_err());
        }
        let mut input = Value::Null;
        for _ in 0..65 {
            input = Value::Array(vec![input]);
        }
        assert!(stable_json(&input).is_err());
    }
}
