use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderDirection {
    #[serde(alias = "Asc", alias = "ASC")]
    Asc,
    #[serde(alias = "Desc", alias = "DESC")]
    Desc,
}

/// Generic paginated list query usable by any feature.
/// `F` is the domain-specific order field enum (must implement `Deserialize`).
/// Any additional query params beyond the known fields are captured in `filters`
/// and can be used for domain-specific filtering (e.g. `mimeType`, `folderId`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery<F> {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub order_by: Option<F>,
    pub direction: Option<OrderDirection>,
    #[serde(flatten)]
    pub filters: HashMap<String, String>,
}

/// Optional list query that preserves existing behavior when parameters are omitted.
/// `F` is the domain-specific order field enum (must implement `Deserialize`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQueryParams<F> {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub order_by: Option<F>,
    pub direction: Option<OrderDirection>,
}

pub fn apply_list_query<T, F, C>(
    mut items: Vec<T>,
    query: &ListQueryParams<F>,
    default_order: F,
    default_direction: OrderDirection,
    mut compare: C,
) -> Vec<T>
where
    F: Copy,
    C: FnMut(&T, &T, F) -> std::cmp::Ordering,
{
    let should_sort = query.order_by.is_some() || query.direction.is_some();
    if should_sort {
        let order_by = query.order_by.unwrap_or(default_order);
        let direction = query.direction.unwrap_or(default_direction);
        items.sort_by(|a, b| {
            let ord = compare(a, b, order_by);
            match direction {
                OrderDirection::Asc => ord,
                OrderDirection::Desc => ord.reverse(),
            }
        });
    }

    let offset = query.offset.unwrap_or(0);
    let offset = if offset < 0 { 0 } else { offset as usize };
    let limit = query.limit.unwrap_or(i64::MAX);
    let limit = if limit <= 0 { 0usize } else { limit as usize };

    items.into_iter().skip(offset).take(limit).collect()
}

fn default_limit() -> i64 {
    50
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Field {
        Name,
    }

    fn q(limit: Option<i64>, offset: Option<i64>) -> ListQueryParams<Field> {
        ListQueryParams {
            limit,
            offset,
            order_by: None,
            direction: None,
        }
    }

    fn sorted_q(dir: OrderDirection) -> ListQueryParams<Field> {
        ListQueryParams {
            limit: None,
            offset: None,
            order_by: Some(Field::Name),
            direction: Some(dir),
        }
    }

    fn run(items: Vec<i32>, params: &ListQueryParams<Field>) -> Vec<i32> {
        apply_list_query(
            items,
            params,
            Field::Name,
            OrderDirection::Asc,
            |a, b, _| a.cmp(b),
        )
    }

    #[test]
    fn no_params_returns_all_items() {
        let result = run(vec![1, 2, 3], &q(None, None));
        assert_eq!(result, vec![1, 2, 3]);
    }

    #[test]
    fn limit_truncates_output() {
        let result = run(vec![1, 2, 3, 4, 5], &q(Some(3), None));
        assert_eq!(result, vec![1, 2, 3]);
    }

    #[test]
    fn offset_skips_items() {
        let result = run(vec![1, 2, 3, 4, 5], &q(None, Some(2)));
        assert_eq!(result, vec![3, 4, 5]);
    }

    #[test]
    fn limit_and_offset_combined() {
        let result = run(vec![1, 2, 3, 4, 5], &q(Some(2), Some(1)));
        assert_eq!(result, vec![2, 3]);
    }

    #[test]
    fn sort_ascending() {
        let result = run(vec![3, 1, 2], &sorted_q(OrderDirection::Asc));
        assert_eq!(result, vec![1, 2, 3]);
    }

    #[test]
    fn sort_descending() {
        let result = run(vec![3, 1, 2], &sorted_q(OrderDirection::Desc));
        assert_eq!(result, vec![3, 2, 1]);
    }

    #[test]
    fn zero_limit_returns_empty() {
        let result = run(vec![1, 2, 3], &q(Some(0), None));
        assert!(result.is_empty());
    }

    #[test]
    fn negative_offset_treated_as_zero() {
        let result = run(vec![1, 2, 3], &q(None, Some(-5)));
        assert_eq!(result, vec![1, 2, 3]);
    }

    #[test]
    fn offset_beyond_length_returns_empty() {
        let result = run(vec![1, 2, 3], &q(None, Some(10)));
        assert!(result.is_empty());
    }
}
