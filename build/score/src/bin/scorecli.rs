//! One-shot scorer. Reads one JSON object on stdin, writes one JSON object.

use poststage_score::{band_for, evaluate, note_for, score_post, PostInput};
use serde_json::{json, Value};
use std::io::{self, Read};

fn main() {
    let mut raw = String::new();
    if let Err(err) = io::stdin().read_to_string(&mut raw) {
        eprintln!("{err}");
        std::process::exit(2);
    }
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };
    let hook = v["hook"].as_str().unwrap_or("");
    let body = v["body"].as_str().unwrap_or("");
    let cta = v["cta"].as_str().unwrap_or("");
    let platform = v["platform"].as_str().unwrap_or("x");
    let label = v["platform_label"].as_str().unwrap_or(platform);
    let best_form = v["best_form"].as_str().unwrap_or("");
    let post = PostInput {
        hook,
        body,
        cta,
        tag_count: v["tag_count"].as_u64().unwrap_or(0) as usize,
        media_count: v["media_count"].as_u64().unwrap_or(0) as usize,
        platform,
        max_chars: v["max_chars"].as_u64().unwrap_or(280) as usize,
        has_best_form: v["has_best_form"].as_bool().unwrap_or(!best_form.is_empty()),
    };
    let score = score_post(&post);
    let checks: Vec<Value> = evaluate(&post)
        .into_iter()
        .map(|c| {
            json!({
                "id": c.id,
                "ok": c.ok,
                "note": note_for(c.id, label, post.max_chars, best_form)
            })
        })
        .collect();
    let out = json!({
        "score": score,
        "band": band_for(score),
        "platform": platform,
        "bestForm": best_form,
        "engine": "rust",
        "checks": checks
    });
    println!("{out}");
}
