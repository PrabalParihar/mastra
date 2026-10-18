---
'@mastra/memory': patch
'@mastra/core': patch
---

Fixed Gemini agents with working memory getting no reply when a turn continued after they called another tool at the same time. The saved history keeps the signature Gemini requires, so the continuation is accepted.

Fixes #27231
