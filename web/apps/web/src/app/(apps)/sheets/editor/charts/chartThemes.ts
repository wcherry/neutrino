// Built-in chart themes for Neutrino Sheets Phase 2.

export type ChartTheme = {
    name: string;
    displayName: string;
    colors: string[];
    backgroundColor: string;
    plotAreaColor: string;
    gridlineColor: string;
    axisColor: string;
    textColor: string;
    fontFamily?: string;
};

export const CHART_THEMES: Record<string, ChartTheme> = {
    default: {
        name: 'default',
        displayName: 'Default',
        colors: ['#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d00', '#46bdc6', '#7c4dff', '#e91e63'],
        backgroundColor: '#ffffff',
        plotAreaColor: 'transparent',
        gridlineColor: '#e5e7eb',
        axisColor: '#6b7280',
        textColor: '#1a1a1a',
    },
    dark: {
        name: 'dark',
        displayName: 'Dark',
        colors: ['#60a5fa', '#f87171', '#fbbf24', '#34d399', '#fb923c', '#22d3ee', '#a78bfa', '#f472b6'],
        backgroundColor: '#1e1e2e',
        plotAreaColor: '#252535',
        gridlineColor: '#374151',
        axisColor: '#9ca3af',
        textColor: '#e5e7eb',
    },
    pastel: {
        name: 'pastel',
        displayName: 'Pastel',
        colors: ['#93c5fd', '#fca5a5', '#fde68a', '#86efac', '#fdba74', '#a5f3fc', '#c4b5fd', '#fbcfe8'],
        backgroundColor: '#fafafa',
        plotAreaColor: 'transparent',
        gridlineColor: '#e5e7eb',
        axisColor: '#9ca3af',
        textColor: '#374151',
    },
    corporate: {
        name: 'corporate',
        displayName: 'Corporate',
        colors: ['#1e3a5f', '#2563eb', '#64748b', '#0891b2', '#475569', '#0284c7', '#1d4ed8', '#334155'],
        backgroundColor: '#ffffff',
        plotAreaColor: '#f8fafc',
        gridlineColor: '#e2e8f0',
        axisColor: '#64748b',
        textColor: '#0f172a',
    },
    colorblind: {
        name: 'colorblind',
        displayName: 'Colorblind Safe',
        colors: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#000000'],
        backgroundColor: '#ffffff',
        plotAreaColor: 'transparent',
        gridlineColor: '#e5e7eb',
        axisColor: '#6b7280',
        textColor: '#1a1a1a',
    },
};

export function getTheme(name?: string): ChartTheme {
    return CHART_THEMES[name ?? 'default'] ?? CHART_THEMES['default'];
}
