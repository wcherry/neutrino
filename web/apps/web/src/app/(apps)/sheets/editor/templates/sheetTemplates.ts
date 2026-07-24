import type { SheetFile, SavedCell } from '../types';
import { numToAlpha } from '../utils';

export interface SheetTemplate {
    id: string;
    name: string;
    description: string;
    /** Small, hand-authored subset used only by the gallery's mini-grid preview. */
    preview: { headers: string[]; rows: string[][] };
    /** Full seeded content, applied when the user picks this template. */
    build: () => SheetFile;
}

// ── Small helpers to keep the 20 templates below readable ──────────────────

function cell(id: string, raw: string, extra?: Partial<SavedCell>): SavedCell {
    return { id, raw, ...extra };
}

function sheetData(name: string, cells: SavedCell[]): SheetFile['sheets'][0] {
    const record: Record<string, SavedCell> = {};
    for (const c of cells) record[c.id] = c;
    return { name, cells: record };
}

function sheetFile(...sheets: SheetFile['sheets']): SheetFile {
    return { sheets };
}

/** Lays out `values` across columns starting at 1-based column `startCol` on `rowNum`. */
function row(rowNum: number, values: string[], startCol = 1, extra?: Partial<SavedCell>): SavedCell[] {
    return values.map((v, i) => cell(`${numToAlpha(startCol + i)}${rowNum}`, v, extra));
}

const bold = { cellStyle: { fontWeight: 'bold' as const } };

// ── 1. Monthly Budget ────────────────────────────────────────────────────────

function buildMonthlyBudget(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Category', 'Budgeted', 'Actual', 'Difference'], 1, bold),
        ...row(2, ['Income'], 1, bold),
        ...row(3, ['Salary', '4500', '4500', '=B3-C3']),
        ...row(4, ['Expenses'], 1, bold),
        ...row(5, ['Rent', '1500', '1500', '=B5-C5']),
        ...row(6, ['Utilities', '200', '215', '=B6-C6']),
        ...row(7, ['Groceries', '450', '480', '=B7-C7']),
        ...row(8, ['Transportation', '150', '140', '=B8-C8']),
        ...row(9, ['Insurance', '120', '120', '=B9-C9']),
        ...row(10, ['Entertainment', '100', '90', '=B10-C10']),
        ...row(11, ['Savings', '500', '500', '=B11-C11']),
        ...row(12, ['Total', '=SUM(B5:B11)', '=SUM(C5:C11)', '=B12-C12'], 1, bold),
    ];
    return sheetFile(sheetData('Budget', cells));
}

// ── 2. Annual Budget ─────────────────────────────────────────────────────────

function buildAnnualBudget(): SheetFile {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const cells: SavedCell[] = [
        ...row(1, ['Category', ...months, 'Total'], 1, bold),
        ...row(2, ['Rent', '1500', '1500', '1500', '1500', '1500', '1500', '1500', '1500', '1500', '1500', '1500', '1500', '=SUM(B2:M2)']),
        ...row(3, ['Groceries', '450', '460', '440', '470', '455', '465', '480', '470', '450', '460', '470', '480', '=SUM(B3:M3)']),
        ...row(4, ['Utilities', '200', '210', '195', '190', '180', '220', '240', '235', '200', '190', '200', '215', '=SUM(B4:M4)']),
        ...row(5, ['Total', '=SUM(B2:B4)', '=SUM(C2:C4)', '=SUM(D2:D4)', '=SUM(E2:E4)', '=SUM(F2:F4)', '=SUM(G2:G4)', '=SUM(H2:H4)', '=SUM(I2:I4)', '=SUM(J2:J4)', '=SUM(K2:K4)', '=SUM(L2:L4)', '=SUM(M2:M4)', '=SUM(N2:N4)'], 1, bold),
    ];
    return sheetFile(sheetData('Annual Budget', cells));
}

// ── 3. Expense Tracker ───────────────────────────────────────────────────────

function buildExpenseTracker(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Date', 'Description', 'Category', 'Payment Method', 'Amount'], 1, bold),
        ...row(2, ['2026-01-03', 'Coffee shop', 'Dining', 'Credit Card', '5.75']),
        ...row(3, ['2026-01-04', 'Gas station', 'Transportation', 'Debit Card', '42.10']),
        ...row(4, ['2026-01-05', 'Grocery store', 'Groceries', 'Credit Card', '86.32']),
        ...row(5, ['2026-01-07', 'Movie tickets', 'Entertainment', 'Cash', '24.00']),
        ...row(6, ['2026-01-10', 'Electric bill', 'Utilities', 'Bank Transfer', '112.45']),
        ...row(7, ['Total', '', '', '', '=SUM(E2:E6)'], 1, bold),
    ];
    return sheetFile(sheetData('Expenses', cells));
}

// ── 4. Invoice ───────────────────────────────────────────────────────────────

function buildInvoice(): SheetFile {
    const cells: SavedCell[] = [
        cell('A1', 'INVOICE', bold),
        cell('A2', 'Invoice #'), cell('B2', 'INV-1001'),
        cell('A3', 'Date'), cell('B3', '2026-01-15'),
        cell('A4', 'Bill To'), cell('B4', 'Acme Corp'),
        cell('A5', 'From'), cell('B5', 'Your Company'),
        ...row(7, ['Description', 'Qty', 'Unit Price', 'Total'], 1, bold),
        ...row(8, ['Consulting services', '10', '150', '=B8*C8']),
        ...row(9, ['Design work', '5', '120', '=B9*C9']),
        ...row(10, ['Support hours', '3', '90', '=B10*C10']),
        ...row(12, ['Subtotal', '', '', '=SUM(D8:D10)']),
        ...row(13, ['Tax (8%)', '', '', '=D12*0.08']),
        ...row(14, ['Total', '', '', '=D12+D13'], 1, bold),
    ];
    return sheetFile(sheetData('Invoice', cells));
}

// ── 5. Quote / Estimate ──────────────────────────────────────────────────────

function buildQuoteEstimate(): SheetFile {
    const cells: SavedCell[] = [
        cell('A1', 'QUOTE / ESTIMATE', bold),
        cell('A2', 'Quote #'), cell('B2', 'Q-2044'),
        cell('A3', 'Valid Until'), cell('B3', '2026-02-15'),
        cell('A4', 'Bill To'), cell('B4', 'Acme Corp'),
        cell('A5', 'From'), cell('B5', 'Your Company'),
        ...row(7, ['Description', 'Qty', 'Unit Price', 'Total'], 1, bold),
        ...row(8, ['Website redesign', '1', '3500', '=B8*C8']),
        ...row(9, ['Hosting (1 year)', '1', '240', '=B9*C9']),
        ...row(11, ['Estimated Total', '', '', '=SUM(D8:D9)'], 1, bold),
    ];
    return sheetFile(sheetData('Quote', cells));
}

// ── 6. Project Tracker ───────────────────────────────────────────────────────

function buildProjectTracker(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Task', 'Owner', 'Status', 'Priority', 'Start Date', 'Due Date', '% Complete'], 1, bold),
        ...row(2, ['Kickoff meeting', 'Alice', 'Done', 'High', '2026-01-05', '2026-01-05', '100']),
        ...row(3, ['Requirements doc', 'Bob', 'Done', 'High', '2026-01-06', '2026-01-10', '100']),
        ...row(4, ['Design mockups', 'Carla', 'In Progress', 'Medium', '2026-01-11', '2026-01-20', '60']),
        ...row(5, ['Backend build', 'Dan', 'In Progress', 'High', '2026-01-15', '2026-02-05', '35']),
        ...row(6, ['QA testing', 'Erin', 'Not Started', 'Medium', '2026-02-06', '2026-02-15', '0']),
    ];
    return sheetFile(sheetData('Project', cells));
}

// ── 7. Task List ─────────────────────────────────────────────────────────────

function buildTaskList(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Task', 'Assigned To', 'Due Date', 'Priority', 'Status'], 1, bold),
        ...row(2, ['Renew domain', 'Alice', '2026-02-01', 'High', 'Not Started']),
        ...row(3, ['Update dependencies', 'Bob', '2026-01-25', 'Medium', 'In Progress']),
        ...row(4, ['Write release notes', 'Carla', '2026-01-30', 'Low', 'Not Started']),
        ...row(5, ['Fix login bug', 'Dan', '2026-01-22', 'High', 'Done']),
    ];
    return sheetFile(sheetData('Tasks', cells));
}

// ── 8. Employee Timesheet ────────────────────────────────────────────────────

function buildTimesheet(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Employee', 'Date', 'Time In', 'Time Out', 'Break (hrs)', 'Total Hours'], 1, bold),
        ...row(2, ['Jamie Lee', '2026-01-05', '09:00', '17:30', '0.5', '=(D2-C2)*24-E2']),
        ...row(3, ['Jamie Lee', '2026-01-06', '09:00', '17:00', '0.5', '=(D3-C3)*24-E3']),
        ...row(4, ['Jamie Lee', '2026-01-07', '08:45', '17:15', '0.5', '=(D4-C4)*24-E4']),
        ...row(5, ['Jamie Lee', '2026-01-08', '09:00', '17:30', '1', '=(D5-C5)*24-E5']),
        ...row(6, ['Jamie Lee', '2026-01-09', '09:00', '16:00', '0.5', '=(D6-C6)*24-E6']),
        ...row(7, ['Total', '', '', '', '', '=SUM(F2:F6)'], 1, bold),
    ];
    return sheetFile(sheetData('Timesheet', cells));
}

// ── 9. Employee Schedule ─────────────────────────────────────────────────────

function buildEmployeeSchedule(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Employee', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], 1, bold),
        ...row(2, ['Jamie Lee', '9-5', '9-5', '9-5', '9-5', '9-5', 'Off', 'Off']),
        ...row(3, ['Sam Rivera', 'Off', '10-6', '10-6', '10-6', '10-6', '10-2', 'Off']),
        ...row(4, ['Priya Shah', '8-4', '8-4', 'Off', '8-4', '8-4', 'Off', 'Off']),
    ];
    return sheetFile(sheetData('Schedule', cells));
}

// ── 10. Inventory Management ─────────────────────────────────────────────────

function buildInventory(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['SKU', 'Item Name', 'Category', 'Qty on Hand', 'Reorder Level', 'Unit Cost', 'Total Value'], 1, bold),
        ...row(2, ['SKU-1001', 'Widget A', 'Hardware', '120', '25', '2.50', '=D2*F2']),
        ...row(3, ['SKU-1002', 'Widget B', 'Hardware', '18', '20', '4.10', '=D3*F3']),
        ...row(4, ['SKU-1003', 'Gadget C', 'Electronics', '75', '15', '9.99', '=D4*F4']),
        ...row(5, ['SKU-1004', 'Cable D', 'Electronics', '300', '50', '0.75', '=D5*F5']),
    ];
    return sheetFile(sheetData('Inventory', cells));
}

// ── 11. Sales Pipeline ───────────────────────────────────────────────────────

function buildSalesPipeline(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Deal Name', 'Company', 'Stage', 'Value', 'Probability', 'Expected Close Date', 'Owner'], 1, bold),
        ...row(2, ['Annual license renewal', 'Acme Corp', 'Negotiation', '48000', '80%', '2026-02-10', 'Alice']),
        ...row(3, ['New platform rollout', 'Globex', 'Proposal', '120000', '50%', '2026-03-01', 'Bob']),
        ...row(4, ['Pilot program', 'Initech', 'Discovery', '15000', '25%', '2026-02-20', 'Carla']),
        ...row(5, ['Upsell — extra seats', 'Umbrella Inc', 'Closed Won', '9000', '100%', '2026-01-12', 'Dan']),
    ];
    return sheetFile(sheetData('Pipeline', cells));
}

// ── 12. CRM Contact List ─────────────────────────────────────────────────────

function buildCrmContacts(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Name', 'Company', 'Email', 'Phone', 'Status', 'Last Contacted', 'Notes'], 1, bold),
        ...row(2, ['Jordan Blake', 'Acme Corp', 'jordan@acme.com', '555-0101', 'Active', '2026-01-10', 'Interested in upgrade']),
        ...row(3, ['Taylor Kim', 'Globex', 'taylor@globex.com', '555-0102', 'Lead', '2026-01-08', 'Requested a demo']),
        ...row(4, ['Morgan Diaz', 'Initech', 'morgan@initech.com', '555-0103', 'Active', '2026-01-05', 'Renewal due Feb']),
    ];
    return sheetFile(sheetData('Contacts', cells));
}

// ── 13. Cash Flow Statement ───────────────────────────────────────────────────

function buildCashFlow(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Category', 'Jan', 'Feb', 'Mar'], 1, bold),
        ...row(2, ['Operating Activities'], 1, bold),
        ...row(3, ['Cash from sales', '12000', '13500', '14200']),
        ...row(4, ['Operating expenses', '-8000', '-8200', '-8600']),
        ...row(5, ['Investing Activities'], 1, bold),
        ...row(6, ['Equipment purchase', '-2000', '0', '-1500']),
        ...row(7, ['Financing Activities'], 1, bold),
        ...row(8, ['Loan proceeds', '0', '5000', '0']),
        ...row(9, ['Net Cash Flow', '=SUM(B3:B4)+SUM(B6:B6)+SUM(B8:B8)', '=SUM(C3:C4)+SUM(C6:C6)+SUM(C8:C8)', '=SUM(D3:D4)+SUM(D6:D6)+SUM(D8:D8)'], 1, bold),
    ];
    return sheetFile(sheetData('Cash Flow', cells));
}

// ── 14. Profit & Loss Statement ───────────────────────────────────────────────

function buildProfitAndLoss(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Category', 'Q1', 'Q2', 'Annual'], 1, bold),
        ...row(2, ['Revenue', '90000', '95000', '=B2+C2']),
        ...row(3, ['COGS', '35000', '36000', '=B3+C3']),
        ...row(4, ['Gross Profit', '=B2-B3', '=C2-C3', '=D2-D3'], 1, bold),
        ...row(5, ['Operating Expenses', '30000', '31000', '=B5+C5']),
        ...row(6, ['Net Income', '=B4-B5', '=C4-C5', '=D4-D5'], 1, bold),
    ];
    return sheetFile(sheetData('P&L', cells));
}

// ── 15. Loan Amortization ─────────────────────────────────────────────────────

function buildLoanAmortization(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Payment #', 'Payment Date', 'Beginning Balance', 'Payment', 'Principal', 'Interest', 'Ending Balance'], 1, bold),
        ...row(2, ['1', '2026-02-01', '20000', '500', '=D2-F2', '=C2*0.005', '=C2-E2']),
        ...row(3, ['2', '2026-03-01', '=G2', '500', '=D3-F3', '=C3*0.005', '=C3-E3']),
        ...row(4, ['3', '2026-04-01', '=G3', '500', '=D4-F4', '=C4*0.005', '=C4-E4']),
        ...row(5, ['4', '2026-05-01', '=G4', '500', '=D5-F5', '=C5*0.005', '=C5-E5']),
    ];
    return sheetFile(sheetData('Amortization', cells));
}

// ── 16. Annual Calendar ───────────────────────────────────────────────────────

function buildAnnualCalendar(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Month', 'Date', 'Day', 'Event'], 1, bold),
        ...row(2, ['January', '2026-01-01', 'Thursday', "New Year's Day"]),
        ...row(3, ['February', '2026-02-14', 'Saturday', "Valentine's Day"]),
        ...row(4, ['March', '2026-03-17', 'Tuesday', "St. Patrick's Day"]),
        ...row(5, ['May', '2026-05-25', 'Monday', 'Memorial Day']),
        ...row(6, ['July', '2026-07-04', 'Saturday', 'Independence Day']),
        ...row(7, ['September', '2026-09-07', 'Monday', 'Labor Day']),
        ...row(8, ['November', '2026-11-26', 'Thursday', 'Thanksgiving']),
        ...row(9, ['December', '2026-12-25', 'Friday', 'Christmas Day']),
    ];
    return sheetFile(sheetData('Calendar', cells));
}

// ── 17. Gantt Chart ────────────────────────────────────────────────────────────

function buildGanttChart(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Task', 'Owner', 'Start Date', 'End Date', 'Duration (days)'], 1, bold),
        ...row(2, ['Discovery', 'Alice', '2026-01-05', '2026-01-12', '=D2-C2']),
        ...row(3, ['Design', 'Bob', '2026-01-13', '2026-01-27', '=D3-C3']),
        ...row(4, ['Development', 'Carla', '2026-01-28', '2026-02-24', '=D4-C4']),
        ...row(5, ['Testing', 'Dan', '2026-02-25', '2026-03-06', '=D5-C5']),
        ...row(6, ['Launch', 'Erin', '2026-03-09', '2026-03-09', '=D6-C6']),
    ];
    return sheetFile(sheetData('Gantt', cells));
}

// ── 18. KPI Dashboard ──────────────────────────────────────────────────────────

function buildKpiDashboard(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['KPI Name', 'Target', 'Actual', '% of Target', 'Status'], 1, bold),
        ...row(2, ['Revenue', '100000', '92000', '=C2/B2', 'On Track']),
        ...row(3, ['New Customers', '200', '215', '=C3/B3', 'Ahead']),
        ...row(4, ['Churn Rate', '5', '6.2', '=C4/B4', 'Behind']),
        ...row(5, ['NPS', '50', '54', '=C5/B5', 'Ahead']),
    ];
    return sheetFile(sheetData('KPI Dashboard', cells));
}

// ── 19. Retirement Planner ────────────────────────────────────────────────────

function buildRetirementPlanner(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Age', 'Year', 'Current Savings', 'Annual Contribution', 'Expected Return %', 'Projected Balance'], 1, bold),
        ...row(2, ['35', '2026', '50000', '6000', '6', '=(C2+D2)*(1+E2/100)']),
        ...row(3, ['36', '2027', '=F2', '6000', '6', '=(C3+D3)*(1+E3/100)']),
        ...row(4, ['37', '2028', '=F3', '6000', '6', '=(C4+D4)*(1+E4/100)']),
        ...row(5, ['38', '2029', '=F4', '6000', '6', '=(C5+D5)*(1+E5/100)']),
    ];
    return sheetFile(sheetData('Retirement', cells));
}

// ── 20. Investment Portfolio Tracker ──────────────────────────────────────────

function buildInvestmentPortfolio(): SheetFile {
    const cells: SavedCell[] = [
        ...row(1, ['Ticker', 'Shares', 'Purchase Price', 'Current Price', 'Market Value', 'Gain/Loss', '% Allocation'], 1, bold),
        ...row(2, ['AAPL', '10', '150', '190', '=B2*D2', '=(D2-C2)*B2', '=E2/E$6']),
        ...row(3, ['MSFT', '5', '280', '340', '=B3*D3', '=(D3-C3)*B3', '=E3/E$6']),
        ...row(4, ['VTI', '20', '210', '225', '=B4*D4', '=(D4-C4)*B4', '=E4/E$6']),
        ...row(5, ['BND', '15', '75', '73', '=B5*D5', '=(D5-C5)*B5', '=E5/E$6']),
        ...row(6, ['Total', '', '', '', '=SUM(E2:E5)', '=SUM(F2:F5)', ''], 1, bold),
    ];
    return sheetFile(sheetData('Portfolio', cells));
}

// ── Catalog ───────────────────────────────────────────────────────────────────

export const SHEET_TEMPLATES: SheetTemplate[] = [
    {
        id: 'monthly-budget',
        name: 'Monthly Budget',
        description: 'Track income and expenses for the month, with automatic differences and totals.',
        preview: {
            headers: ['Category', 'Budgeted', 'Actual', 'Difference'],
            rows: [
                ['Salary', '4500', '4500', '0'],
                ['Rent', '1500', '1500', '0'],
                ['Groceries', '450', '480', '-30'],
            ],
        },
        build: buildMonthlyBudget,
    },
    {
        id: 'annual-budget',
        name: 'Annual Budget',
        description: 'A full-year budget with monthly columns and running totals per category.',
        preview: {
            headers: ['Category', 'Jan', 'Feb', 'Total'],
            rows: [
                ['Rent', '1500', '1500', '3000'],
                ['Groceries', '450', '460', '910'],
            ],
        },
        build: buildAnnualBudget,
    },
    {
        id: 'expense-tracker',
        name: 'Expense Tracker',
        description: 'Log everyday expenses by date, category, and payment method.',
        preview: {
            headers: ['Date', 'Description', 'Category', 'Amount'],
            rows: [
                ['2026-01-03', 'Coffee shop', 'Dining', '5.75'],
                ['2026-01-04', 'Gas station', 'Transportation', '42.10'],
            ],
        },
        build: buildExpenseTracker,
    },
    {
        id: 'invoice',
        name: 'Invoice',
        description: 'A billable invoice with line items, subtotal, tax, and total calculations.',
        preview: {
            headers: ['Description', 'Qty', 'Unit Price', 'Total'],
            rows: [
                ['Consulting services', '10', '150', '1500'],
                ['Design work', '5', '120', '600'],
            ],
        },
        build: buildInvoice,
    },
    {
        id: 'quote-estimate',
        name: 'Quote / Estimate',
        description: 'Send a price quote or estimate to a prospective client before work begins.',
        preview: {
            headers: ['Description', 'Qty', 'Unit Price', 'Total'],
            rows: [
                ['Website redesign', '1', '3500', '3500'],
                ['Hosting (1 year)', '1', '240', '240'],
            ],
        },
        build: buildQuoteEstimate,
    },
    {
        id: 'project-tracker',
        name: 'Project Tracker',
        description: 'Track project tasks with owners, status, priority, and completion percentage.',
        preview: {
            headers: ['Task', 'Owner', 'Status', 'Priority'],
            rows: [
                ['Kickoff meeting', 'Alice', 'Done', 'High'],
                ['Design mockups', 'Carla', 'In Progress', 'Medium'],
            ],
        },
        build: buildProjectTracker,
    },
    {
        id: 'task-list',
        name: 'Task List',
        description: 'A simple to-do list with assignees, due dates, and priority.',
        preview: {
            headers: ['Task', 'Assigned To', 'Due Date', 'Status'],
            rows: [
                ['Renew domain', 'Alice', '2026-02-01', 'Not Started'],
                ['Fix login bug', 'Dan', '2026-01-22', 'Done'],
            ],
        },
        build: buildTaskList,
    },
    {
        id: 'employee-timesheet',
        name: 'Employee Timesheet',
        description: 'Record daily clock-in/out times and compute total hours worked per week.',
        preview: {
            headers: ['Employee', 'Date', 'Time In', 'Time Out'],
            rows: [
                ['Jamie Lee', '2026-01-05', '09:00', '17:30'],
                ['Jamie Lee', '2026-01-06', '09:00', '17:00'],
            ],
        },
        build: buildTimesheet,
    },
    {
        id: 'employee-schedule',
        name: 'Employee Schedule',
        description: 'A weekly shift schedule showing each employee across Monday through Sunday.',
        preview: {
            headers: ['Employee', 'Mon', 'Tue', 'Wed'],
            rows: [
                ['Jamie Lee', '9-5', '9-5', '9-5'],
                ['Sam Rivera', 'Off', '10-6', '10-6'],
            ],
        },
        build: buildEmployeeSchedule,
    },
    {
        id: 'inventory-management',
        name: 'Inventory Management',
        description: 'Track stock levels, reorder points, and total inventory value by SKU.',
        preview: {
            headers: ['SKU', 'Item Name', 'Qty on Hand', 'Total Value'],
            rows: [
                ['SKU-1001', 'Widget A', '120', '300.00'],
                ['SKU-1002', 'Widget B', '18', '73.80'],
            ],
        },
        build: buildInventory,
    },
    {
        id: 'sales-pipeline',
        name: 'Sales Pipeline',
        description: 'Track deals moving through your sales pipeline by stage and value.',
        preview: {
            headers: ['Deal Name', 'Company', 'Stage', 'Value'],
            rows: [
                ['Annual license renewal', 'Acme Corp', 'Negotiation', '48000'],
                ['New platform rollout', 'Globex', 'Proposal', '120000'],
            ],
        },
        build: buildSalesPipeline,
    },
    {
        id: 'crm-contact-list',
        name: 'CRM Contact List',
        description: 'A simple CRM-style contact list for tracking leads and customer relationships.',
        preview: {
            headers: ['Name', 'Company', 'Status', 'Last Contacted'],
            rows: [
                ['Jordan Blake', 'Acme Corp', 'Active', '2026-01-10'],
                ['Taylor Kim', 'Globex', 'Lead', '2026-01-08'],
            ],
        },
        build: buildCrmContacts,
    },
    {
        id: 'cash-flow-statement',
        name: 'Cash Flow Statement',
        description: 'Summarize operating, investing, and financing activities into a net cash flow.',
        preview: {
            headers: ['Category', 'Jan', 'Feb', 'Mar'],
            rows: [
                ['Cash from sales', '12000', '13500', '14200'],
                ['Net Cash Flow', '2000', '10300', '4100'],
            ],
        },
        build: buildCashFlow,
    },
    {
        id: 'profit-and-loss-statement',
        name: 'Profit & Loss Statement',
        description: 'A P&L summary calculating gross profit and net income by quarter.',
        preview: {
            headers: ['Category', 'Q1', 'Q2', 'Annual'],
            rows: [
                ['Revenue', '90000', '95000', '185000'],
                ['Net Income', '25000', '28000', '53000'],
            ],
        },
        build: buildProfitAndLoss,
    },
    {
        id: 'loan-amortization',
        name: 'Loan Amortization',
        description: 'Break down loan payments into principal and interest with a running balance.',
        preview: {
            headers: ['Payment #', 'Beginning Balance', 'Payment', 'Ending Balance'],
            rows: [
                ['1', '20000', '500', '19600'],
                ['2', '19600', '500', '19198'],
            ],
        },
        build: buildLoanAmortization,
    },
    {
        id: 'annual-calendar',
        name: 'Annual Calendar',
        description: 'A year-at-a-glance calendar highlighting key dates and events by month.',
        preview: {
            headers: ['Month', 'Date', 'Day', 'Event'],
            rows: [
                ['January', '2026-01-01', 'Thursday', "New Year's Day"],
                ['July', '2026-07-04', 'Saturday', 'Independence Day'],
            ],
        },
        build: buildAnnualCalendar,
    },
    {
        id: 'gantt-chart',
        name: 'Gantt Chart',
        description: 'Plan project phases with start/end dates and computed durations.',
        preview: {
            headers: ['Task', 'Owner', 'Start Date', 'End Date'],
            rows: [
                ['Discovery', 'Alice', '2026-01-05', '2026-01-12'],
                ['Design', 'Bob', '2026-01-13', '2026-01-27'],
            ],
        },
        build: buildGanttChart,
    },
    {
        id: 'kpi-dashboard',
        name: 'KPI Dashboard',
        description: 'Monitor key performance indicators against targets, e.g. revenue and NPS.',
        preview: {
            headers: ['KPI Name', 'Target', 'Actual', 'Status'],
            rows: [
                ['Revenue', '100000', '92000', 'On Track'],
                ['New Customers', '200', '215', 'Ahead'],
            ],
        },
        build: buildKpiDashboard,
    },
    {
        id: 'retirement-planner',
        name: 'Retirement Planner',
        description: 'Project retirement savings growth year over year based on contributions and returns.',
        preview: {
            headers: ['Age', 'Year', 'Current Savings', 'Projected Balance'],
            rows: [
                ['35', '2026', '50000', '59360'],
                ['36', '2027', '59360', '69161.6'],
            ],
        },
        build: buildRetirementPlanner,
    },
    {
        id: 'investment-portfolio-tracker',
        name: 'Investment Portfolio Tracker',
        description: 'Track holdings, market value, gain/loss, and allocation across your portfolio.',
        preview: {
            headers: ['Ticker', 'Shares', 'Market Value', 'Gain/Loss'],
            rows: [
                ['AAPL', '10', '1900', '400'],
                ['MSFT', '5', '1700', '300'],
            ],
        },
        build: buildInvestmentPortfolio,
    },
];
