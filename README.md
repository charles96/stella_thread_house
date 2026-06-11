[![Docker Hub](https://img.shields.io/github/v/tag/charles96/stella_thread_house?sort=semver&logo=docker&logoColor=white&label=Docker%20Hub&color=2496ED)](https://hub.docker.com/r/charles1031/stella-th)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs)](https://nestjs.com/)
[![Tavily](https://img.shields.io/badge/Tavily-Search-FF6B35)](https://tavily.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

- [세종대왕](./README_KR.md)

# Stella's Thread House
![intro](./assets/imgs/content_screen.png)
* I'm a big fan of Jennie. If there are any copyright issues, I will remove the content.

## Overview
This service was born from a simple question: instead of extracting information from AI and manually moving it into separate documents, could we document the AI responses themselves to manage knowledge permanently? And could we automatically link related documents by considering the relationships between the current document and others, making information easier to navigate?

## How It Works
A question asked to an LLM can become a subtitle. For example, the message "Tell me about the modern history of our country" can be turned into a title like "Modern History of Our Country." Based on the generated response, hashtags are automatically created by AI, and documents can be linked (Related Documents) based on matching hashtags from other documents. Of course, hashtags can have homonyms, so the more hashtags two documents share, the closer the relationship. When the LLM responds using web search, the referenced documents (Reference Documents) are visualized, numbered, and cited within the response to show which sources were used. Based on this, a loose implementation of the Zettelkasten method has been applied.

## Feature Details
### Modes
There are two modes: **Thread** and **Chat**. Writing in Thread mode automatically generates hashtags and links documents together. If you want to ask casual questions lightly, use Chat mode. However, Chat mode uses the same base engine for AI responses but does not support related document linking via hashtags or editing of AI-generated messages.

### Thread Mode
1. **Reference Documents**
   - When the AI performs a web search to answer a question, the referenced web pages are numbered, and images or other content from the search appear above them. Key images or YouTube videos related to the document can be pinned to the screen. The content editor also allows you to delete unnecessary images and reposition them.
2. **User message → Subtitle conversion**
   - Clicking on a user message allows you to edit it into a subtitle/title.
3. **Right-side menu**
   - Reorder and move sections up or down by subtitle
   - Delete a document set (question + answer) by subtitle
   - Manage AI-generated hashtags (add/delete)
   - **Related Documents** — browse documents linked by shared hashtags

### Dashboard
- Browse recent posts and view hashtag generation info
![dashboard_main](./assets/imgs/dashboard_main.png)
- Visualize connections across all documents
![dashboard_graph](./assets/imgs/dashboard_graph.png)

## How I Use It
Here are some ways I personally use this service:
1. Paste a YouTube link and request a summary, play it in PiP mode, and ask follow-up questions mid-video to study.
2. When reading a book, web-search for a summary of the book, then document questions that come up while reading.
3. Provide a web link on a specific topic and have the content organized.

## Requirements
Tested primarily with the gemma4 and oss-20b models served via Ollama / LM Studio.
**The API Endpoint must end with `/v1`!**
- ex) http://ollama:11434 → http://100.78.190.8:11434/v1

| Type | Purpose |
|--|--|
| Local LLM | OpenAI-compatible endpoint URL |
| Tavily API Key | For web search |

## Tested AI Models
Built against the OpenAI GPT-compatible spec. Below is the list of models that have been tested.
* Note: every AI Endpoint must end with `/v1`!

| Type | Model | Purpose |
|--|--|--|
| Ollama | Gemma4:26b | Reasoning Model |
| Ollama | Gemma4:26b | Vision Model |
| OpenAI | gpt-4o | Reasoning Model |
| OpenAI | gpt-4o | Vision Model |
| Anthropic | opus | Reasoning Model |

# Deploy

## Quick Start
- You only need an **admin account + AI endpoint + Tavily key**.

**`.env`**
```env
TH_ADMIN_EMAIL_ID=admin@example.com         # admin login email
TH_ADMIN_PASSWORD=changeme1234              # admin login password
OPENAI_BASE_URL=https://api.openai.com/v1   # AI Endpoint URL
OPENAI_API_KEY=sk-xxxxxxxx                  # OpenAI key (not needed for local LLM servers without auth)
TAVILY_API_KEY=tvly-xxxxxxxx                # web search (omit to disable)
```

**`docker-compose.yml`**
```yaml
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: stella
      POSTGRES_USER: stella
      POSTGRES_PASSWORD: stella
    volumes:
      - pgdata:/var/lib/postgresql/18/docker

  app:
    image: charles1031/stella-th:latest
    restart: unless-stopped          # retries until Postgres is ready
    ports:
      - "3100:3100"                  # web (frontend)
      - "4100:4100"                  # API (backend)
    env_file: .env
    environment:
      DATABASE_URL: postgres://stella:stella@postgres:5432/stella
    depends_on:
      - postgres

volumes:
  pgdata:
```

```bash
docker compose up -d
```
Open **http://localhost:3100** and log in with the admin account above. Set/adjust the AI model under **Settings → AI**.

> Need custom ports, host volumes, healthchecks, or a reverse proxy? See the full setup below.

## 1. Create `.env` file

```env
# ── Required ──────────────────────────────────────────
# Admin account created on first boot
TH_ADMIN_EMAIL_ID=admin@example.com
TH_ADMIN_PASSWORD=changeme1234

# Web (frontend) host port behind your reverse proxy. Change on port conflict.
TH_PORT=3100

# AI provider — OpenAI-compatible base URL (include /v1) + API key.
#   OpenAI cloud:  https://api.openai.com/v1
#   Local runtime (vLLM/LM Studio …): http://host.docker.internal:11434/v1
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx   # leave empty for local servers that need no auth

# ── Optional ──────────────────────────────────────────
# Web search feature (disabled if not provided)
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxxx

# DB credentials (can be omitted to use defaults)
# POSTGRES_USER=stella
# POSTGRES_PASSWORD=stella_dev_pass
# POSTGRES_DB=stella
```

## 2. Create `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:18-alpine
    container_name: stella-th-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-stella}
      POSTGRES_USER: ${POSTGRES_USER:-stella}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-stella_dev_pass}
    volumes:
      - postgres-data:/var/lib/postgresql/18/docker
    networks:
      - stella-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-stella} -d ${POSTGRES_DB:-stella}"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 10s

  app:
    image: charles1031/stella-th:1.1.0   # Docker Hub — replace with the latest tag
    container_name: stella-th-app
    restart: unless-stopped
    ports:
      - "4100:4100"   # backend (NestJS)
      - "${TH_PORT:-3100}:3100"   # web (frontend) — change TH_PORT in .env on conflict
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-stella}:${POSTGRES_PASSWORD:-stella_dev_pass}@postgres:5432/${POSTGRES_DB:-stella}
      UPLOAD_DIR: /app/backend/uploads
      LOG_DIR: /app/backend/logs
    volumes:
      - attachments-data:/app/backend/uploads
      - logs-data:/app/backend/logs
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - stella-net

networks:
  stella-net:
    driver: bridge

volumes:
  postgres-data:
  attachments-data:
  logs-data:
```

## 3. Run

```bash
docker compose up -d
```

## 4. Access
- http://localhost:3100
