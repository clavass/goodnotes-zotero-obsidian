---
type: source
citekey: {{citekey}}
title: "{{title | replace('"', "'")}}"
authors: [{% for c in creators %}"{% if c.name %}{{c.name}}{% else %}{{c.lastName}}{% if c.firstName %}, {{c.firstName}}{% endif %}{% endif %}"{% if not loop.last %}, {% endif %}{% endfor %}]
year: {% if date %}{{date | format("YYYY")}}{% endif %}
journal: "{{publicationTitle | replace('"', "'")}}"
doi: {{DOI}}
zotero: "{{desktopURI}}"
status: to read
topics: []
tags: [source]
created: {{importDate | format("YYYY-MM-DD")}}
---

# {{title}}

**Citation:** {{bibliography}}
**Open in Zotero:** [link]({{desktopURI}}){% if pdfZoteroLink %} · **PDF:** {{pdfZoteroLink}}{% endif %}

## Abstract
{{abstractNote}}

## My notes
{% persist "notes" %}{% if isFirstImport %}
- **Question / aim:** 
- **Method:** 
- **Key findings:** 
- **Limitations:** 
- **Connections:** 
{% endif %}{% endpersist %}

## Highlights from Zotero
{% for a in annotations -%}
{% if a.annotatedText or a.comment or a.imageRelativePath -%}
{% if a.annotatedText %}> {{a.annotatedText}} ([p. {{a.page}}](zotero://open-pdf/library/items/{{a.attachment.itemKey}}?page={{a.page}}&annotation={{a.id}}))
{% endif -%}
{% if a.imageRelativePath %}![[{{a.imageRelativePath}}]]
{% endif -%}
{% if a.comment %}
{{a.comment}}
{% endif %}
{% endif -%}
{% endfor %}
