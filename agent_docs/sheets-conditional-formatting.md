If you’re building Neutrino Sheets, I would recommend treating conditional formatting as a first-class feature, not just a collection of formatting rules. The most successful spreadsheet products make conditional formatting:

1. Easy for casual users.
2. Powerful enough for analysts.
3. Fast on large sheets.
4. Consistent with sorting, filtering, and collaboration.

⸻

Feature Goals

Users should be able to:

* Highlight important values.
* Visualize trends.
* Detect outliers.
* Monitor status.
* Build dashboards.
* Create custom business rules.

⸻

Tier 1 (MVP)

These are the features that virtually every Excel and Google Sheets user expects.

1. Single Color Rules

Examples:

Rule	Example
Greater Than	> 100
Less Than	< 0
Equal To	= “Closed”
Not Equal To	<> “”
Between	10-20
Contains Text	“Error”
Date Is	Today
Is Empty	Blank cells

Formatting options:

* Background color
* Text color
* Bold
* Italic
* Underline

Example:

Value > 1000
→ Green background

⸻

2. Color Scale Rules

One of the most used features in both Excel and Sheets.

Two-Color Scale

Low = Red
High = Green

Three-Color Scale

Low = Red
Mid = Yellow
High = Green

Examples:

* Sales
* Grades
* Performance metrics

⸻

3. Data Bars

Visual bar chart inside a cell.

Example:

20  ████
50  ██████████
90  ██████████████████

Options:

* Solid fill
* Gradient fill
* Positive/negative colors

⸻

4. Icon Sets

Examples:

Traffic Lights

🟢
🟡
🔴

Arrows

↑
→
↓

Ratings

⭐
⭐⭐
⭐⭐⭐

Common business use:

Above Target → Green
Near Target → Yellow
Below Target → Red

⸻

5. Duplicate Detection

Built-in rule.

Examples:

Highlight duplicates
Highlight unique values

Very commonly used.

⸻

6. Top/Bottom Rules

Examples:

Top 10 values
Top 10%
Bottom 10 values
Bottom 5%

Useful for reporting.

⸻

7. Above/Below Average

Examples:

Above Average
Below Average

Simple but frequently used.

⸻

Tier 2 (Power User Features)

These separate Excel-class products from lightweight spreadsheets.

8. Formula-Based Rules

The most powerful feature.

Example:

=A2>B2

Highlight cell when true.

Example:

=MOD(ROW(),2)=0

Alternate row coloring.

Example:

=$C2="Completed"

Highlight entire row.

Recommendation:

Store formulas exactly as normal spreadsheet formulas and evaluate to TRUE/FALSE.

⸻

9. Relative vs Absolute References

Support:

A1
$A1
A$1
$A$1

Without this, advanced formatting becomes frustrating.

⸻

10. Whole Row Rules

Example:

=$D2="Overdue"

Applied to:

A2:H500

Entire row becomes red.

Extremely common in project trackers.

⸻

11. Multiple Rule Layers

Allow many rules on the same range.

Example:

Rule 1:

Value > 100
Green

Rule 2:

Value > 500
Blue

Rule 3:

Value > 1000
Purple

⸻

12. Rule Priority

Excel supports:

Move Up
Move Down

Rule evaluation order matters.

Example:

Rule 1
Rule 2
Rule 3

Later rules may override earlier ones.

⸻

13. Stop If True

Excel feature worth copying.

Example:

Rule A
Stop If True

Prevents additional rules from executing.

Major performance benefit.

⸻

Tier 3 (Dashboard Features)

These make spreadsheets feel modern.

⸻

14. Heat Maps

Essentially advanced color scales.

Use cases:

* Financial analysis
* KPI dashboards
* Resource allocation

⸻

15. Progress Bars

More advanced version of Data Bars.

Examples:

75% ███████████░░░░

Useful for project tracking.

⸻

16. Status Indicators

Built-in templates:

Project Status

Not Started
In Progress
Blocked
Done

Priority

Low
Medium
High
Critical

Approval

Pending
Approved
Rejected

Users love not having to configure these manually.

⸻

17. Calendar-Based Rules

Examples:

Today
Tomorrow
Past Due
Next Week
This Month

Very common in planning sheets.

⸻

Tier 4 (Modern Features Missing From Excel)

These are areas where Neutrino could exceed both Excel and Google Sheets.

⸻

18. Theme-Aware Formatting

Current spreadsheets hardcode colors.

Instead:

Success
Warning
Danger
Info

Map to theme tokens.

When user changes theme:

Light Mode
Dark Mode
Corporate Theme

Formatting automatically updates.

⸻

19. Conditional Formatting Variables

Allow reusable named rules.

Example:

High Revenue
=Revenue > 100000

Reuse everywhere.

⸻

20. Rule Templates

Users save:

Sales Dashboard Rules

Apply to another sheet.

⸻

21. Conditional Formatting by Column Type

Example:

Currency Column

Automatically offer:

* Profit/Loss colors
* Budget overrun colors

Example:

Task Status Column

Automatically offer:

* Status indicators

⸻

22. Dynamic Rules from Filters

Example:

Top 10 Visible Values

instead of

Top 10 All Values

Useful in dashboards.

⸻

23. AI-Assisted Rule Builder

Example:

User types:

Highlight customers who haven't ordered in 90 days.

Neutrino generates:

=TODAY()-LastOrderDate>90

This would be a strong differentiator.

⸻

UX Recommendations

Rule Sidebar

Google Sheets’ sidebar is easier than Excel’s modal-heavy approach.

Recommended:

Conditional Formatting
 ├─ Rule Type
 ├─ Apply To
 ├─ Preview
 ├─ Formatting
 ├─ Advanced Formula

Live preview while editing.

⸻

Rule Manager

Dedicated manager:

□ Enabled
↑ ↓ Priority
Name
Apply To
Last Modified

This is much easier than Excel’s rule editor.

⸻

Recommended MVP Roadmap

Phase 1

* Greater/Less/Equal
* Text Rules
* Date Rules
* Duplicate Detection
* Color Formatting
* Rule Manager

Phase 2

* Color Scales
* Data Bars
* Top/Bottom
* Above/Below Average

Phase 3

* Formula Rules
* Relative References
* Rule Priority
* Stop If True

Phase 4

* Icon Sets
* Status Templates
* Dashboard Features

Phase 5

* Theme-Aware Rules
* Saved Templates
* AI Rule Builder

This progression gets Neutrino Sheets to roughly 80% of real-world Excel/Google Sheets conditional formatting usage by the end of Phase 3, while Phases 4–5 provide differentiation rather than simply matching competitors.