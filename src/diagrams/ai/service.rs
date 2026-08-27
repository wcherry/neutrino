use crate::shared::{AiClient, AiCredentials};
use serde_json::{json, Value};
use std::sync::Arc;
use tracing::error;

/// Shape types the model is allowed to use.
///
/// A subset of the editor's `ShapeType` union (`web/apps/web/src/app/(apps)/diagrams/types.ts`) —
/// enough to draw a flowchart, an architecture sketch, an ERD or a BPMN process, and short enough
/// to spend on every prompt. Anything outside the list is rewritten to `rectangle` rather than
/// passed through, because the canvas draws nothing at all for a type it does not know.
const ALLOWED_SHAPE_TYPES: &[&str] = &[
    "rectangle",
    "rounded-rectangle",
    "ellipse",
    "circle",
    "triangle",
    "diamond",
    "hexagon",
    "parallelogram",
    "flowchart-process",
    "flowchart-decision",
    "flowchart-terminator",
    "flowchart-document",
    "flowchart-data",
    "uml-class",
    "uml-actor",
    "uml-component",
    "network-server",
    "network-database",
    "network-cloud",
    "network-firewall",
    "network-router",
    "bpmn-start-event",
    "bpmn-end-event",
    "bpmn-task",
    "bpmn-gateway-exclusive",
    "bpmn-gateway-parallel",
    "erd-entity",
    "erd-relationship",
    "sticky-note",
    "text",
];

/// Connector routing styles the model is allowed to use — the editor's `ConnectorType` union.
const ALLOWED_CONNECTOR_TYPES: &[&str] = &["straight", "orthogonal", "curved", "elbow"];

const DEFAULT_SHAPE_WIDTH: f64 = 160.0;
const DEFAULT_SHAPE_HEIGHT: f64 = 80.0;
/// Columns used when the model omits coordinates and the shapes have to be laid out for it.
const FALLBACK_COLUMNS: usize = 4;
const FALLBACK_COL_SPACING: f64 = 220.0;
const FALLBACK_ROW_SPACING: f64 = 140.0;

pub struct DiagramsAIService {
    ai: Arc<AiClient>,
}

impl DiagramsAIService {
    pub fn new(ai: Arc<AiClient>) -> Self {
        DiagramsAIService { ai }
    }

    /// Turn a plain-language description into shapes and connectors for the diagram canvas.
    pub async fn generate_diagram(
        &self,
        credentials: &AiCredentials,
        prompt: &str,
    ) -> Result<Value, String> {
        let full_prompt = format!(
            "You are a diagramming assistant. Draw the following diagram:\n\n{}\n\n\
Return a JSON object with exactly two keys:\n\
- shapes: array of objects with `id` (short unique string), `type` (one of: {}), `x`, `y`, \
`width`, `height` (numbers, canvas coordinates on a 1200x800 page, origin top-left), and `label` (string).\n\
- connectors: array of objects with `sourceId` and `targetId` (ids of shapes in `shapes`), \
`type` (one of: {}), and `label` (string, may be empty).\n\n\
Lay the shapes out so none of them overlap, leaving at least 40px between neighbours, and flow \
left-to-right or top-to-bottom in the direction the process reads. Use no more than 20 shapes. \
Return only the JSON object, no explanation.",
            prompt,
            ALLOWED_SHAPE_TYPES.join(", "),
            ALLOWED_CONNECTOR_TYPES.join(", "),
        );

        let response = self.ai.complete(credentials, &full_prompt, 4096).await?;

        let trimmed = response.trim();
        let json_start = trimmed.find('{').unwrap_or(0);
        let json_end = trimmed.rfind('}').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        let parsed: Value = serde_json::from_str(json_str).map_err(|e| {
            error!("Failed to parse generate_diagram response as JSON: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })?;

        let diagram = normalise_diagram(&parsed);
        let no_shapes = diagram["shapes"]
            .as_array()
            .map(|s| s.is_empty())
            .unwrap_or(true);
        if no_shapes {
            return Err("The AI returned no shapes for that prompt".to_string());
        }

        Ok(diagram)
    }
}

/// Coerce a model's answer into the shape the editor inserts.
///
/// The editor trusts what it is handed — a shape with no geometry lands at 0x0 with no size, and a
/// connector naming a shape that was never returned draws to nowhere — so every field is defaulted
/// here and dangling connectors are dropped rather than passed on.
fn normalise_diagram(value: &Value) -> Value {
    let raw_shapes = value["shapes"].as_array().cloned().unwrap_or_default();

    let mut shapes = Vec::with_capacity(raw_shapes.len());
    let mut ids = Vec::with_capacity(raw_shapes.len());

    for (i, raw) in raw_shapes.iter().enumerate() {
        let id = raw["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("shape-{}", i));
        if ids.contains(&id) {
            continue;
        }

        let shape_type = raw["type"].as_str().unwrap_or("rectangle");
        let shape_type = if ALLOWED_SHAPE_TYPES.contains(&shape_type) {
            shape_type
        } else {
            "rectangle"
        };

        let width = positive_number(&raw["width"]).unwrap_or(DEFAULT_SHAPE_WIDTH);
        let height = positive_number(&raw["height"]).unwrap_or(DEFAULT_SHAPE_HEIGHT);
        let column = i % FALLBACK_COLUMNS;
        let row = i / FALLBACK_COLUMNS;

        shapes.push(json!({
            "id": id,
            "type": shape_type,
            "x": raw["x"].as_f64().unwrap_or(60.0 + column as f64 * FALLBACK_COL_SPACING),
            "y": raw["y"].as_f64().unwrap_or(60.0 + row as f64 * FALLBACK_ROW_SPACING),
            "width": width,
            "height": height,
            "label": raw["label"].as_str().unwrap_or_default(),
        }));
        ids.push(id);
    }

    let connectors = value["connectors"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|raw| {
            let source_id = raw["sourceId"].as_str()?.to_string();
            let target_id = raw["targetId"].as_str()?.to_string();
            if !ids.contains(&source_id) || !ids.contains(&target_id) {
                return None;
            }

            let connector_type = raw["type"].as_str().unwrap_or("orthogonal");
            let connector_type = if ALLOWED_CONNECTOR_TYPES.contains(&connector_type) {
                connector_type
            } else {
                "orthogonal"
            };

            Some(json!({
                "type": connector_type,
                "sourceId": source_id,
                "targetId": target_id,
                "label": raw["label"].as_str().unwrap_or_default(),
            }))
        })
        .collect::<Vec<_>>();

    json!({ "shapes": shapes, "connectors": connectors })
}

/// A dimension is only usable if it is a number greater than zero; a 0-wide shape is invisible.
fn positive_number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| *n > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_missing_geometry_and_labels() {
        let diagram = normalise_diagram(&json!({
            "shapes": [
                { "id": "a", "type": "flowchart-process" },
                { "id": "b", "type": "flowchart-process", "x": 400, "y": 200, "width": 0 },
            ],
            "connectors": [],
        }));

        let shapes = diagram["shapes"].as_array().unwrap();
        assert_eq!(shapes[0]["x"], 60.0);
        assert_eq!(shapes[0]["y"], 60.0);
        assert_eq!(shapes[0]["width"], DEFAULT_SHAPE_WIDTH);
        assert_eq!(shapes[0]["label"], "");
        // Given coordinates are kept; a zero width is not.
        assert_eq!(shapes[1]["x"], 400.0);
        assert_eq!(shapes[1]["y"], 200.0);
        assert_eq!(shapes[1]["width"], DEFAULT_SHAPE_WIDTH);
    }

    #[test]
    fn rewrites_unknown_types_to_defaults() {
        let diagram = normalise_diagram(&json!({
            "shapes": [
                { "id": "a", "type": "database" },
                { "id": "b", "type": "network-database" },
            ],
            "connectors": [{ "sourceId": "a", "targetId": "b", "type": "zigzag" }],
        }));

        assert_eq!(diagram["shapes"][0]["type"], "rectangle");
        assert_eq!(diagram["shapes"][1]["type"], "network-database");
        assert_eq!(diagram["connectors"][0]["type"], "orthogonal");
    }

    #[test]
    fn drops_connectors_that_name_a_missing_shape() {
        let diagram = normalise_diagram(&json!({
            "shapes": [{ "id": "a" }, { "id": "b" }],
            "connectors": [
                { "sourceId": "a", "targetId": "b" },
                { "sourceId": "a", "targetId": "ghost" },
                { "sourceId": "a" },
            ],
        }));

        let connectors = diagram["connectors"].as_array().unwrap();
        assert_eq!(connectors.len(), 1);
        assert_eq!(connectors[0]["targetId"], "b");
    }

    #[test]
    fn drops_duplicate_shape_ids() {
        // Two shapes sharing an id would make every connector to that id ambiguous.
        let diagram = normalise_diagram(&json!({
            "shapes": [
                { "id": "a", "label": "first" },
                { "id": "a", "label": "second" },
            ],
            "connectors": [],
        }));

        let shapes = diagram["shapes"].as_array().unwrap();
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0]["label"], "first");
    }

    #[test]
    fn tolerates_a_response_with_no_arrays() {
        let diagram = normalise_diagram(&json!({ "explanation": "here you go" }));
        assert_eq!(diagram["shapes"].as_array().unwrap().len(), 0);
        assert_eq!(diagram["connectors"].as_array().unwrap().len(), 0);
    }
}
