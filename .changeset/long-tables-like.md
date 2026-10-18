---
'@mastra/memory': patch
'@mastra/core': patch
---

Fixed continued Gemini turns being rejected after working memory was updated alongside other tools. Gemini's thought signature stays on the first remaining tool call.

Fixes #27231
