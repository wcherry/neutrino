-- Additional slide templates inspired by Google Slides and PowerPoint themes.
-- Photo templates use picsum.photos placeholder images.
-- Elements have no IDs; the frontend assigns UIDs on apply.

-- ── Layout templates ────────────────────────────────────────────────────────

-- 15. Three Column  (GS "3 columns" / PPT "Three Content")
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-three-col', NULL, 'Three Column', 'Three equal content columns', 'content',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":5,"w":90,"h":14,"content":"Three Column Layout","style":{"fontSize":34,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":5,"y":20,"w":90,"h":1,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":25,"w":28,"h":65,"content":"Column One\n\n• Point one\n• Point two\n• Point three","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}},{"type":"text","x":36,"y":25,"w":28,"h":65,"content":"Column Two\n\n• Point one\n• Point two\n• Point three","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}},{"type":"text","x":67,"y":25,"w":28,"h":65,"content":"Column Three\n\n• Point one\n• Point two\n• Point three","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  150
);

-- 16. Left Accent Bar  (inspired by GS "Spearmint" / PPT "Slate" themes)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-left-accent', NULL, 'Left Accent Bar', 'Colored left sidebar accent with title and body', 'basic',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":5,"h":100,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":8,"y":8,"w":88,"h":20,"content":"Slide Title","style":{"fontSize":38,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":8,"y":29,"w":84,"h":1,"fill":"#e5e7eb","stroke":"transparent","strokeWidth":0},{"type":"text","x":8,"y":33,"w":84,"h":58,"content":"Click to add content","style":{"fontSize":21,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  160
);

-- 17. Bottom Band  (inspired by PPT "Retrospect" / GS footer-strip themes)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-bottom-band', NULL, 'Bottom Band', 'White slide with colored accent band at the bottom', 'basic',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"text","x":5,"y":10,"w":90,"h":22,"content":"Presentation Title","style":{"fontSize":44,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"left","fontFamily":"Inter"}},{"type":"text","x":5,"y":34,"w":90,"h":44,"content":"Click to add subtitle or body content","style":{"fontSize":22,"bold":false,"italic":false,"underline":false,"color":"#6b7280","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":0,"y":82,"w":100,"h":18,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":85,"w":70,"h":12,"content":"Your Name · Organization","style":{"fontSize":16,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.85)","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  170
);

-- 18. Gradient Cover  (inspired by GS "Coral" / "Plum" gradient title slides)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-gradient-cover', NULL, 'Gradient Cover', 'Bold title over a vibrant indigo-to-purple gradient', 'basic',
  '{"background":{"type":"color","value":"#312e81"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":100,"h":100,"fill":"rgba(99,102,241,0.35)","stroke":"transparent","strokeWidth":0},{"type":"text","x":8,"y":22,"w":84,"h":32,"content":"Presentation Title","style":{"fontSize":52,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"center","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":35,"y":56,"w":30,"h":2,"fill":"rgba(255,255,255,0.5)","stroke":"transparent","strokeWidth":0},{"type":"text","x":10,"y":60,"w":80,"h":16,"content":"Subtitle · Author · Date","style":{"fontSize":20,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.75)","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  180
);

-- 19. Dark Quote  (inspired by GS "Luxe" dark theme)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-dark-quote', NULL, 'Dark Quote', 'Elegant centered quote on a dark background', 'content',
  '{"background":{"type":"color","value":"#0f172a"},"elements":[{"type":"text","x":10,"y":12,"w":18,"h":24,"content":"\u201c","style":{"fontSize":96,"bold":true,"italic":false,"underline":false,"color":"#4f46e5","align":"left","fontFamily":"Inter"}},{"type":"text","x":10,"y":28,"w":80,"h":38,"content":"Insert your most compelling quote or key insight here.","style":{"fontSize":28,"bold":false,"italic":true,"underline":false,"color":"#f1f5f9","align":"center","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":40,"y":68,"w":20,"h":1,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":20,"y":72,"w":60,"h":12,"content":"— Attribution, Title","style":{"fontSize":17,"bold":false,"italic":false,"underline":false,"color":"#94a3b8","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  190
);

-- 20. News / Headline  (inspired by GS "Momentum" / PPT "Basis" layout)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-news-headline', NULL, 'News Headline', 'Large left headline with supporting detail on the right', 'content',
  '{"background":{"type":"color","value":"#ffffff"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":52,"h":100,"fill":"#1e1b4b","stroke":"transparent","strokeWidth":0},{"type":"text","x":4,"y":15,"w":44,"h":60,"content":"Big Headline Goes Here","style":{"fontSize":42,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":4,"y":77,"w":20,"h":2,"fill":"#818cf8","stroke":"transparent","strokeWidth":0},{"type":"text","x":4,"y":82,"w":44,"h":12,"content":"Category · Date","style":{"fontSize":14,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.6)","align":"left","fontFamily":"Inter"}},{"type":"text","x":56,"y":12,"w":40,"h":74,"content":"Supporting detail, context, or bullet points that complement the main headline.\n\n• Key point one\n• Key point two\n• Key point three","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  200
);

-- 21. Decorative Circles  (inspired by PPT "Ion" / "Office Theme" with shape accents)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-circle-accent', NULL, 'Circle Accent', 'Title slide with decorative circle shapes inspired by PowerPoint Ion', 'basic',
  '{"background":{"type":"color","value":"#1e3a5f"},"elements":[{"type":"shape","shape":"circle","x":68,"y":-20,"w":60,"h":107,"fill":"rgba(255,255,255,0.06)","stroke":"transparent","strokeWidth":0},{"type":"shape","shape":"circle","x":76,"y":10,"w":40,"h":71,"fill":"rgba(255,255,255,0.08)","stroke":"transparent","strokeWidth":0},{"type":"text","x":6,"y":25,"w":62,"h":30,"content":"Presentation Title","style":{"fontSize":46,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":6,"y":57,"w":28,"h":2,"fill":"#38bdf8","stroke":"transparent","strokeWidth":0},{"type":"text","x":6,"y":62,"w":60,"h":16,"content":"Subtitle or author name","style":{"fontSize":20,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.75)","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  210
);

-- ── Photo templates ─────────────────────────────────────────────────────────

-- 22. Split Photo  (GS "Big number" / PPT left-half image layouts)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-split-photo', NULL, 'Split Photo', 'Left half photo background, right half content — inspired by Google Slides split layouts', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/split-photo/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":50,"y":0,"w":50,"h":100,"fill":"#ffffff","stroke":"transparent","strokeWidth":0},{"type":"text","x":54,"y":15,"w":42,"h":26,"content":"Section Title","style":{"fontSize":38,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":54,"y":43,"w":20,"h":2,"fill":"#4f46e5","stroke":"transparent","strokeWidth":0},{"type":"text","x":54,"y":48,"w":42,"h":42,"content":"Add your key message or supporting content here.\n\n• Detail one\n• Detail two","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#374151","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  220
);

-- 23. Gradient Photo Overlay  (PPT photo with gradient side band)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-photo-gradient', NULL, 'Photo Gradient', 'Photo background with a left-to-right gradient overlay for readability', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-gradient/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":58,"h":100,"fill":"rgba(15,23,42,0.82)","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":20,"w":50,"h":30,"content":"Your Headline Here","style":{"fontSize":44,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"left","fontFamily":"Inter"}},{"type":"shape","shape":"rect","x":5,"y":52,"w":24,"h":2,"fill":"#818cf8","stroke":"transparent","strokeWidth":0},{"type":"text","x":5,"y":57,"w":50,"h":28,"content":"Supporting subtitle or description text that provides context for your audience.","style":{"fontSize":19,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.8)","align":"left","fontFamily":"Inter"}}],"transition":"fade"}',
  230
);

-- 24. Centered Photo Title  (GS "Tropic" / PPT full-bleed with centered white band)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-photo-center-band', NULL, 'Photo Center Band', 'Photo background with a translucent center band for the title', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-centerband/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":32,"w":100,"h":36,"fill":"rgba(255,255,255,0.92)","stroke":"transparent","strokeWidth":0},{"type":"text","x":8,"y":35,"w":84,"h":18,"content":"Presentation Title","style":{"fontSize":40,"bold":true,"italic":false,"underline":false,"color":"#1f2937","align":"center","fontFamily":"Inter"}},{"type":"text","x":12,"y":54,"w":76,"h":12,"content":"Subtitle or event name · Date","style":{"fontSize":18,"bold":false,"italic":false,"underline":false,"color":"#6b7280","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  240
);

-- 25. Vignette Focus  (inspired by PPT "Parallax" / GS nature overlay)
INSERT INTO slide_templates (id, user_id, name, description, category, content, sort_order) VALUES (
  'tpl-photo-vignette', NULL, 'Vignette Focus', 'Photo with dark vignette edges to draw attention to the center text', 'photo',
  '{"background":{"type":"image","value":"https://picsum.photos/seed/slides-vignette/1280/720","objectFit":"cover"},"elements":[{"type":"shape","shape":"rect","x":0,"y":0,"w":100,"h":100,"fill":"rgba(0,0,0,0.38)","stroke":"transparent","strokeWidth":0},{"type":"text","x":12,"y":30,"w":76,"h":22,"content":"Your Key Message","style":{"fontSize":50,"bold":true,"italic":false,"underline":false,"color":"#ffffff","align":"center","fontFamily":"Inter"}},{"type":"text","x":18,"y":55,"w":64,"h":14,"content":"Supporting detail or subtitle goes here","style":{"fontSize":21,"bold":false,"italic":false,"underline":false,"color":"rgba(255,255,255,0.85)","align":"center","fontFamily":"Inter"}}],"transition":"fade"}',
  250
);
