use crate::sheets::ai::claude_client::ClaudeClient;
use serde::{Deserialize, Serialize};
use tracing::error;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExploreResponse {
    pub answer: String,
    pub formula: Option<String>,
    pub chart_config: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Insight {
    pub row: i32,
    pub col: i32,
    #[serde(rename = "type")]
    pub insight_type: String,
    pub message: String,
}

pub struct SheetsAIService {
    claude: Option<ClaudeClient>,
}

impl SheetsAIService {
    pub fn new(claude: Option<ClaudeClient>) -> Self {
        SheetsAIService { claude }
    }

    fn get_claude(&self) -> Result<&ClaudeClient, String> {
        self.claude
            .as_ref()
            .ok_or_else(|| "AI features require ANTHROPIC_API_KEY to be configured".to_string())
    }

    pub async fn smart_fill(
        &self,
        column_values: Vec<String>,
        examples: Vec<(String, String)>,
    ) -> Result<Vec<String>, String> {
        let claude = self.get_claude()?;

        let examples_str = examples
            .iter()
            .map(|(input, output)| format!("Input: {} -> Output: {}", input, output))
            .collect::<Vec<_>>()
            .join("\n");

        let remaining_str = column_values.join(", ");

        let prompt = format!(
            "Given these input/output examples:\n{}\n\nComplete the output for these inputs: {}\n\nReturn only a JSON array of strings with the completed values, one per input. Do not include any explanation.",
            examples_str, remaining_str
        );

        let response = claude.complete(&prompt, 1024).await?;

        // Try to extract JSON array from response
        let trimmed = response.trim();
        let json_start = trimmed.find('[').unwrap_or(0);
        let json_end = trimmed.rfind(']').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        serde_json::from_str::<Vec<String>>(json_str).map_err(|e| {
            error!("Failed to parse smart_fill response as JSON array: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })
    }

    pub async fn explore(
        &self,
        question: &str,
        sheet_data: &str,
    ) -> Result<ExploreResponse, String> {
        let claude = self.get_claude()?;

        let prompt = format!(
            "You are a spreadsheet analysis assistant. Here is the spreadsheet data in JSON format:\n{}\n\nUser question: {}\n\nRespond with a JSON object with these fields:\n- answer: string (your answer to the question)\n- formula: string or null (a spreadsheet formula if applicable)\n- chartConfig: object or null (chart configuration if a chart would help visualize the answer)\n\nReturn only the JSON object, no explanation.",
            sheet_data, question
        );

        let response = claude.complete(&prompt, 2048).await?;

        let trimmed = response.trim();
        let json_start = trimmed.find('{').unwrap_or(0);
        let json_end = trimmed.rfind('}').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        let raw: serde_json::Value = serde_json::from_str(json_str).map_err(|e| {
            error!("Failed to parse explore response as JSON: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })?;

        Ok(ExploreResponse {
            answer: raw["answer"]
                .as_str()
                .unwrap_or("No answer provided")
                .to_string(),
            formula: raw["formula"].as_str().map(|s| s.to_string()),
            chart_config: raw.get("chartConfig").cloned(),
        })
    }

    pub async fn generate_pivot(
        &self,
        prompt: &str,
        sheet_data: &str,
    ) -> Result<serde_json::Value, String> {
        let claude = self.get_claude()?;

        let full_prompt = format!(
            "You are a spreadsheet pivot table assistant. Here is the spreadsheet data in JSON format:\n{}\n\nUser request: {}\n\nGenerate a pivot table configuration as a JSON object with these fields:\n- rows: array of strings (row dimension field names)\n- columns: array of strings (column dimension field names)\n- values: array of objects with 'field' and 'aggregation' (sum/count/average/max/min)\n- filters: array of objects with 'field' and 'values'\n\nReturn only the JSON object, no explanation.",
            sheet_data, prompt
        );

        let response = claude.complete(&full_prompt, 2048).await?;

        let trimmed = response.trim();
        let json_start = trimmed.find('{').unwrap_or(0);
        let json_end = trimmed.rfind('}').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        serde_json::from_str::<serde_json::Value>(json_str).map_err(|e| {
            error!("Failed to parse pivot response as JSON: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })
    }

    pub async fn get_insights(&self, sheet_data: &str) -> Result<Vec<Insight>, String> {
        let claude = self.get_claude()?;

        let prompt = format!(
            "You are a spreadsheet data analyst. Here is the spreadsheet data in JSON format:\n{}\n\nAnalyze this data and identify anomalies, patterns, or notable insights. Return a JSON array of insight objects, each with these fields:\n- row: integer (0-based row index, use -1 if not cell-specific)\n- col: integer (0-based column index, use -1 if not cell-specific)\n- type: string (one of: 'anomaly', 'trend', 'warning', 'info')\n- message: string (description of the insight)\n\nReturn only the JSON array, no explanation. Limit to at most 10 insights.",
            sheet_data
        );

        let response = claude.complete(&prompt, 2048).await?;

        let trimmed = response.trim();
        let json_start = trimmed.find('[').unwrap_or(0);
        let json_end = trimmed.rfind(']').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        serde_json::from_str::<Vec<Insight>>(json_str).map_err(|e| {
            error!("Failed to parse insights response as JSON array: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })
    }
}
