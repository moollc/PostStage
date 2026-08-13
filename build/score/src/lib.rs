//! Marketability helpers.
//!
//! The JS fallback in `source/shared/score.js` is the runtime default and must
//! always work; this crate is an optional WASM accelerator. Nothing here is
//! required for the app to run, and `wasm-pack` is never needed to start it.
//!
//! The contract mirrored here is the one `scorePost` produces:
//!
//! ```text
//! { score, band, platform, bestForm, parts, checks: [{ id, ok, note }] }
//! ```
//!
//! Everything in this module is pure — no I/O, no globals — so the same input
//! always yields the same checks in the same order as the JS.

/// Percentage of passed checks, 0 when there are no checks.
///
/// Rounds half away from zero to match the JS `Math.round((passed/total)*100)`.
/// Integer truncation would sit a point below the JS for every inexact
/// fraction (3/8 gives 37 rather than 38), and since the `ready`/`draft` bands
/// are threshold comparisons, that one point can also flip the band. Rust is
/// the live scorer and JS the fallback, so the two have to agree exactly.
pub fn clamp_score(passed: u32, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    (passed * 200 + total) / (total * 2)
}

/// One heuristic check. `id` matches the JS check ids one-for-one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub id: &'static str,
    pub ok: bool,
}

/// The post fields the checks read. Borrowed, so callers do not have to
/// allocate to score a draft.
#[derive(Debug, Clone, Default)]
pub struct PostInput<'a> {
    pub hook: &'a str,
    pub body: &'a str,
    pub cta: &'a str,
    pub tag_count: usize,
    pub media_count: usize,
    /// Platform id, e.g. `"x"`, `"instagram"`.
    pub platform: &'a str,
    /// Platform character ceiling; `scorePost` falls back to 280.
    pub max_chars: usize,
    /// Whether the platform declares a `bestForm` string.
    pub has_best_form: bool,
}

/// Band names used by the UI. Thresholds match the JS: >=80 ready, >=55 draft.
pub fn band_for(score: u32) -> &'static str {
    if score >= 80 {
        "ready"
    } else if score >= 55 {
        "draft"
    } else {
        "thin"
    }
}

/// Platforms that are allowed to ship as text only.
fn text_only_ok(platform: &str) -> bool {
    matches!(platform, "x" | "linkedin")
}

/// A CTA is generic when it is one of the stock phrases the JS rejects.
/// Case-insensitive, matching the JS `/click here|link in bio/i`.
fn cta_is_generic(cta: &str) -> bool {
    let lower = cta.to_lowercase();
    lower.contains("click here") || lower.contains("link in bio")
}

/// Filler words dropped before comparing a hook against a CTA. Mirrors
/// `STOPWORDS` in `source/shared/score.js`.
const STOPWORDS: [&str; 14] = [
    "a", "an", "the", "to", "and", "or", "of", "for", "in", "on", "is", "it", "your", "you",
];

/// Lowercase `[a-z0-9']+` runs with stopwords removed — the JS `words()`.
fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '\''))
        .filter(|w| !w.is_empty() && !STOPWORDS.contains(w))
        .map(|w| w.to_string())
        .collect()
}

/// True when every meaningful CTA word already appears in the hook, i.e. the
/// hook just restates the call. An empty hook or CTA is never an echo, matching
/// the JS `hookRepeatsCta`.
fn hook_repeats_cta(hook: &str, cta: &str) -> bool {
    let cta_words = words(cta);
    if hook.is_empty() || cta_words.is_empty() {
        return false;
    }
    let hook_words = words(hook);
    cta_words.iter().all(|w| hook_words.contains(w))
}

/// Run the same seven checks as `scorePost` in `source/shared/score.js`,
/// in the same order and with the same ids.
///
/// Lengths are measured over trimmed text; `length` is checked against the
/// hook, body, and CTA joined by single spaces, exactly as the JS does.
pub fn evaluate(post: &PostInput) -> Vec<Check> {
    let hook = post.hook.trim();
    let body = post.body.trim();
    let cta = post.cta.trim();
    let full_len = [hook, body, cta].join(" ").chars().count();
    let hook_len = hook.chars().count();
    let max_chars = if post.max_chars == 0 { 280 } else { post.max_chars };

    vec![
        Check { id: "hook", ok: hook_len >= 8 && hook_len <= 90 },
        Check { id: "body", ok: body.chars().count() >= 40 },
        Check { id: "cta", ok: !cta.is_empty() && !cta_is_generic(cta) },
        Check { id: "hook-cta-echo", ok: !hook_repeats_cta(hook, cta) },
        Check { id: "length", ok: full_len <= max_chars },
        Check { id: "media", ok: post.media_count > 0 || text_only_ok(post.platform) },
        Check { id: "tags", ok: post.tag_count <= 6 },
        Check { id: "form", ok: post.has_best_form },
    ]
}

/// Score a post: the percentage of checks that passed.
pub fn score_post(post: &PostInput) -> u32 {
    let checks = evaluate(post);
    let passed = checks.iter().filter(|c| c.ok).count() as u32;
    clamp_score(passed, checks.len() as u32)
}

/// UI copy for a check id. Kept here so the live scorer and JS stay aligned.
pub fn note_for(id: &str, platform_label: &str, max_chars: usize, best_form: &str) -> String {
    match id {
        "hook" => "Hook is short enough to read in a glance".into(),
        "body" => "Body has enough meat to keep a stranger".into(),
        "cta" => "Call is specific, not a generic wave".into(),
        "hook-cta-echo" => "Hook does not just repeat the call word-for-word".into(),
        "length" => format!("Fits {platform_label} length ({max_chars} chars)"),
        "media" => "Media present, or platform can live on text".into(),
        "tags" => "Tags are sparse enough to look human".into(),
        "form" => format!("Best form on {platform_label}: {best_form}"),
        _ => id.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strong<'a>() -> PostInput<'a> {
        PostInput {
            hook: "Ship the thing today",
            body: "A long enough body to keep a stranger reading past the first line of it.",
            cta: "Reply with the one metric you track",
            tag_count: 2,
            media_count: 1,
            platform: "x",
            max_chars: 2200,
            has_best_form: true,
        }
    }

    #[test]
    fn score_is_percent() {
        assert_eq!(clamp_score(3, 4), 75);
    }

    #[test]
    fn zero_total_is_zero() {
        assert_eq!(clamp_score(0, 0), 0);
        assert_eq!(clamp_score(5, 0), 0);
    }

    /// Every possible score for the real 8-check run, against what JS
    /// `Math.round((passed / 8) * 100)` produces. Truncating instead of
    /// rounding put Rust a point under JS on all five inexact fractions.
    #[test]
    fn eighths_match_js_rounding() {
        let expected = [0, 13, 25, 38, 50, 63, 75, 88, 100];
        for (passed, want) in expected.iter().enumerate() {
            assert_eq!(clamp_score(passed as u32, 8), *want, "{passed}/8");
        }
    }

    /// Rounding has to be able to move a score up across a band edge.
    /// 11/20 is 55 exactly; 43/80 rounds to 54 and must stay `thin`.
    #[test]
    fn rounding_respects_band_edges() {
        assert_eq!(clamp_score(11, 20), 55);
        assert_eq!(band_for(clamp_score(11, 20)), "draft");
        assert_eq!(clamp_score(43, 80), 54);
        assert_eq!(band_for(clamp_score(43, 80)), "thin");
        // Half-way cases round up, as Math.round does.
        assert_eq!(clamp_score(1, 8), 13);
        assert_eq!(clamp_score(5, 8), 63);
    }

    #[test]
    fn bands_match_js_thresholds() {
        assert_eq!(band_for(100), "ready");
        assert_eq!(band_for(80), "ready");
        assert_eq!(band_for(79), "draft");
        assert_eq!(band_for(55), "draft");
        assert_eq!(band_for(54), "thin");
        assert_eq!(band_for(0), "thin");
    }

    #[test]
    fn check_ids_and_order_match_js() {
        let ids: Vec<&str> = evaluate(&strong()).iter().map(|c| c.id).collect();
        assert_eq!(
            ids,
            vec!["hook", "body", "cta", "hook-cta-echo", "length", "media", "tags", "form"]
        );
    }

    #[test]
    fn a_strong_post_passes_everything() {
        assert_eq!(score_post(&strong()), 100);
    }

    #[test]
    fn short_hook_fails_but_long_one_does_too() {
        let mut p = strong();
        p.hook = "Hi";
        assert!(!evaluate(&p)[0].ok);
        let long = "x".repeat(91);
        p.hook = &long;
        assert!(!evaluate(&p)[0].ok);
    }

    #[test]
    fn generic_cta_is_rejected_case_insensitively() {
        let mut p = strong();
        p.cta = "Click HERE";
        assert!(!evaluate(&p)[2].ok);
        p.cta = "Link In Bio";
        assert!(!evaluate(&p)[2].ok);
        p.cta = "";
        assert!(!evaluate(&p)[2].ok);
    }

    /// Look a check up by id so these tests survive future reordering.
    fn check(post: &PostInput, id: &str) -> bool {
        evaluate(post).into_iter().find(|c| c.id == id).expect("check exists").ok
    }

    #[test]
    fn text_only_platforms_need_no_media() {
        let mut p = strong();
        p.media_count = 0;
        p.platform = "x";
        assert!(check(&p, "media"));
        p.platform = "linkedin";
        assert!(check(&p, "media"));
        p.platform = "instagram";
        assert!(!check(&p, "media"));
    }

    #[test]
    fn zero_max_chars_falls_back_to_280() {
        let long = "y".repeat(400);
        let p = PostInput { hook: "A fine hook here", body: &long, max_chars: 0, ..strong() };
        assert!(!check(&p, "length"));
    }

    #[test]
    fn tags_cap_at_six() {
        let mut p = strong();
        p.tag_count = 6;
        assert!(check(&p, "tags"));
        p.tag_count = 7;
        assert!(!check(&p, "tags"));
    }

    #[test]
    fn hook_echoing_the_cta_fails() {
        let mut p = strong();
        // Every meaningful CTA word already sits in the hook.
        p.hook = "Reply with the one metric you track";
        p.cta = "Reply with your metric";
        assert!(!check(&p, "hook-cta-echo"));
    }

    #[test]
    fn stopwords_do_not_make_an_echo() {
        let mut p = strong();
        p.hook = "Most dashboards lie to you";
        p.cta = "Reply with the metric you trust";
        assert!(check(&p, "hook-cta-echo"));
    }

    #[test]
    fn empty_hook_or_cta_is_not_an_echo() {
        let mut p = strong();
        p.cta = "";
        assert!(check(&p, "hook-cta-echo"));
        p.cta = "Reply with your metric";
        p.hook = "";
        assert!(check(&p, "hook-cta-echo"));
        // A CTA of nothing but stopwords has no meaningful words either.
        p.hook = "Ship the thing today";
        p.cta = "to the";
        assert!(check(&p, "hook-cta-echo"));
    }

    #[test]
    fn echo_ignores_case_and_punctuation() {
        let mut p = strong();
        p.hook = "Track the ONE metric, always";
        p.cta = "Track your metric!";
        assert!(!check(&p, "hook-cta-echo"));
    }

    /// The note strings are what the rail actually renders, so they have to be
    /// byte-identical to the ones in `source/shared/score.js` (lines 18-25).
    /// If the JS copy changes, this test is the thing that catches the drift.
    #[test]
    fn notes_match_js_copy() {
        assert_eq!(note_for("hook", "X", 280, ""), "Hook is short enough to read in a glance");
        assert_eq!(note_for("body", "X", 280, ""), "Body has enough meat to keep a stranger");
        assert_eq!(note_for("cta", "X", 280, ""), "Call is specific, not a generic wave");
        assert_eq!(
            note_for("hook-cta-echo", "X", 280, ""),
            "Hook does not just repeat the call word-for-word"
        );
        assert_eq!(note_for("media", "X", 280, ""), "Media present, or platform can live on text");
        assert_eq!(note_for("tags", "X", 280, ""), "Tags are sparse enough to look human");
    }

    #[test]
    fn interpolated_notes_use_platform_and_form() {
        assert_eq!(
            note_for("length", "Instagram", 2200, ""),
            "Fits Instagram length (2200 chars)"
        );
        assert_eq!(
            note_for("form", "TikTok", 4000, "Hook in 1s, pattern interrupt, spoken CTA"),
            "Best form on TikTok: Hook in 1s, pattern interrupt, spoken CTA"
        );
    }

    /// An id with no copy falls through to the id itself rather than panicking,
    /// so a new check added to `evaluate` still renders something.
    #[test]
    fn unknown_note_id_falls_back_to_the_id() {
        assert_eq!(note_for("not-a-check", "X", 280, ""), "not-a-check");
    }

    /// Every id `evaluate` emits must have real copy, not the id fallback.
    #[test]
    fn every_check_id_has_a_note() {
        for c in evaluate(&strong()) {
            let note = note_for(c.id, "X", 280, "a form");
            assert_ne!(note, c.id, "check `{}` has no note copy", c.id);
            assert!(!note.is_empty());
        }
    }
}
