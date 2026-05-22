-- Slide templates: system templates (user_id IS NULL) and user-saved templates.
CREATE TABLE slide_templates (
    id          TEXT PRIMARY KEY NOT NULL,
    user_id     TEXT,              -- NULL = system template, visible to everyone
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'basic',
    content     TEXT NOT NULL,     -- JSON: { background, elements[], transition }
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX slide_templates_user_id_idx ON slide_templates (user_id);
CREATE INDEX slide_templates_sort_idx   ON slide_templates (sort_order);

-- ── System templates (user_id = NULL) ────────────────────────────────────────
-- Elements are stored without ids; the frontend assigns new uids on apply.

-- 1. Blank
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-blank', NULL, 'Blank', 'Empty slide', 'basic',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[],"transition":"fade"}',
  10
);

-- 2. Title Slide  (like PowerPoint "Title Slide" / Google Slides "Title slide")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-title', NULL, 'Title Slide', 'Large title with subtitle', 'basic',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":10,"y":25,"w":80,"h":22,"content":"Presentation Title","style":{"fontSize":48,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"text","x":15,"y":53,"w":70,"h":12,"content":"Subtitle or author name","style":{"fontSize":24,"bold":false,"italic":false,"underline":false,"color":"#6b7280","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  20
);

-- 3. Title and Body  (like PPT "Title and Content" / GS "Title and body")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-title-body', NULL, 'Title and Body', 'Title with content area', 'basic',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":5,"w":90,"h":15,"content":"Slide Title","style":{"fontSize":36,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":5,"y":21,"w":90,"h":1,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":25,"w":90,"h":65,"content":"Click to add content","style":{"fontSize":22,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  30
);

-- 4. Title Only  (like PPT "Title Only" / GS "Title only")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-title-only', NULL, 'Title Only', 'Title with free content area', 'basic',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":40,"w":90,"h":20,"content":"Slide Title","style":{"fontSize":40,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  40
);

-- 5. Section Header  (like PPT "Section Header" / GS "Section header")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-section', NULL, 'Section Header', 'Bold section divider with accent background', 'basic',
  '{"background":{"type":"color","value":"#4f46e5"},"elements":[{"type":"text","x":10,"y":33,"w":80,"h":28,"content":"Section Title","style":{"fontSize":52,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"center","fontFamily":"Inter"}},{"type":"text","x":20,"y":63,"w":60,"h":12,"content":"Section subtitle","style":{"fontSize":20,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.8)","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  50
);

-- 6. Two Column  (like PPT "Two Content" / GS "Two columns")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-two-col', NULL, 'Two Column', 'Side-by-side content areas', 'content',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":5,"w":90,"h":15,"content":"Two Column Layout","style":{"fontSize":36,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"text","x":5,"y":25,"w":43,"h":65,"content":"Left Column\n\n• Point one\n• Point two\n• Point three","style":{"fontSize":20,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}},{"type":"text","x":52,"y":25,"w":43,"h":65,"content":"Right Column\n\n• Point one\n• Point two\n• Point three","style":{"fontSize":20,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  60
);

-- 7. Comparison  (like PPT "Comparison")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-comparison', NULL, 'Comparison', 'Compare two options side by side', 'content',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":4,"w":90,"h":14,"content":"Comparison","style":{"fontSize":36,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":5,"y":20,"w":43,"h":72,"fill":"#ede9fe","stroke":"#4f46e5","strokeWidth":2},{"type":"shape","shape":"rect","x":52,"y":20,"w":43,"h":72,"fill":"#f0fdf4","stroke":"#15803d","strokeWidth":2},{"type":"text","x":5,"y":21,"w":43,"h":13,"content":"Option A","style":{"fontSize":24,"bold":true,"italic":false,"underline":false,"color":"#4f46e5","align":"center","fontFamily":"Inter"}},{"type":"text","x":52,"y":21,"w":43,"h":13,"content":"Option B","style":{"fontSize":24,"bold":true,"italic":false,"underline":false,"color":"#15803d","align":"center","fontFamily":"Inter"}},{"type":"text","x":7,"y":36,"w":39,"h":52,"content":"+ Advantage one\n+ Advantage two\n+ Advantage three","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}},{"type":"text","x":54,"y":36,"w":39,"h":52,"content":"+ Advantage one\n+ Advantage two\n+ Advantage three","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  70
);

-- 8. Agenda  (inspired by GS / PPT agenda layouts)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-agenda', NULL, 'Agenda', 'Numbered agenda items with divider', 'content',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":5,"w":90,"h":14,"content":"Agenda","style":{"fontSize":38,"bold":true,"italic":false,"underline":false,"color":"#4f46e5","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":5,"y":20,"w":90,"h":2,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":26,"w":90,"h":65,"content":"01  Introduction\n\n02  Main Topic\n\n03  Discussion\n\n04  Q & A","style":{"fontSize":22,"bold":false,"italic":false,"underline":false,"color":"#1f2937","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  80
);

-- 9. Quote  (like GS "Quote" layout)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-quote', NULL, 'Quote', 'Centered pull quote with attribution', 'content',
  '{"background":{"type":"color","value":"#f8fafc"},"elements":[{"type":"text","x":10,"y":18,"w":80,"h":48,"content":"The best way to predict the future is to create it.","style":{"fontSize":30,"bold":false,"italic":true,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"text","x":20,"y":70,"w":60,"h":12,"content":"— Attribution","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#6b7280","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  90
);

-- 10. Big Number / Stat  (like PPT "Big Number" / GS stat slide)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-stat', NULL, 'Big Stat', 'Highlight a key metric or number', 'content',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":10,"y":18,"w":80,"h":38,"content":"42%","style":{"fontSize":96,"bold":true,"italic":false,"underline":false,"color":"#4f46e5","align":"center","fontFamily":"Inter"}},{"type":"text","x":15,"y":58,"w":70,"h":14,"content":"Describe what this metric means","style":{"fontSize":22,"bold":false,"italic":false,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"text","x":20,"y":74,"w":60,"h":10,"content":"Source or context here","style":{"fontSize":14,"bold":false,"italic":true,"underline":false,"color":"#6b7280","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  100
);

-- 11. Bold Photo Title  (image bg — like PPT photo theme title / GS photo slide)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-photo-title', NULL, 'Bold Photo Title', 'Large title over a full-bleed photo', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-bold/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":100,"h":100,"fill":"rgba(0,0,0,0.45)","stroke":"transparent","strokeWidth":0},{"type":"text","x":10,"y":28,"w":80,"h":28,"content":"Bold Photo Title","style":{"fontSize":52,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"center","fontFamily":"Inter"}},{"type":"text","x":15,"y":60,"w":70,"h":14,"content":"Subtitle text goes here","style":{"fontSize":24,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.85)","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  110
);

-- 12. Photo with Caption  (image bg — like GS "Main point" with photo)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-photo-caption', NULL, 'Photo with Caption', 'Photo background with title and caption bar', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-caption/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":74,"w":100,"h":26,"fill":"rgba(0,0,0,0.68)","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":76,"w":90,"h":14,"content":"Photo Title","style":{"fontSize":32,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"left","fontFamily":"Inter"}},{"type":"text","x":5,"y":88,"w":90,"h":10,"content":"Caption or description text here","style":{"fontSize":16,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.8)","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  120
);

-- 13. Full Bleed Statement  (image bg — like PPT impact slide)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-statement', NULL, 'Full Bleed Statement', 'Bold statement over a full-screen photo', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-statement/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":100,"h":100,"fill":"rgba(15,23,42,0.6)","stroke":"transparent","strokeWidth":0},{"type":"text","x":10,"y":35,"w":80,"h":30,"content":"Make Your Statement Here","style":{"fontSize":44,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  130
);

-- 14. Dark Hero  (image bg — like PPT "Ion" / GS premium theme opener)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-dark-hero', NULL, 'Dark Hero', 'Left-aligned headline over a dark photo', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-hero/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":100,"h":100,"fill":"rgba(0,0,0,0.55)","stroke":"transparent","strokeWidth":0},{"type":"shape","shape":"rect","x":8,"y":72,"w":50,"h":1,"fill":"#ffffff","stroke":"transparent","strokeWidth":0},{"type":"text","x":8,"y":18,"w":84,"h":46,"content":"Your Compelling Headline","style":{"fontSize":48,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"left","fontFamily":"Inter"}},{"type":"text","x":8,"y":76,"w":60,"h":14,"content":"Supporting subtitle text here","style":{"fontSize":20,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.85)","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  140
);
