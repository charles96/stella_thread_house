[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs)](https://nestjs.com/)
[![Tavily](https://img.shields.io/badge/Tavily-Search-FF6B35)](https://tavily.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

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
| Type | Purpose |
|--|--|
| Local LLM | Gemma4 26b (OpenAI-compatible endpoint) |
| Tavily API Key | For web search |

# Deploy

## 1. Create `.env` file

```env
# ── Required ──────────────────────────────────────────
# Admin account created on first boot
TH_ADMIN_EMAIL_ID=admin@example.com
TH_ADMIN_PASSWORD=changeme1234

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
    image: registry.webnori.com/stella-th:1.2.7   # Replace with the latest tag
    container_name: stella-th-app
    restart: unless-stopped
    ports:
      - "4100:4100"   # backend (NestJS)
      - "3100:3100"   # frontend (Next.js)
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
    extra_hosts:
      - "host.docker.internal:host-gateway"   # Required on Linux to reach a local model server on the host

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

| Service | URL |
|--------|-----|
| Frontend | http://localhost:3100 |
| Backend API | http://localhost:4100 |

> **Notes**
> - `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `TAVILY_API_KEY` are seeded into the DB on first boot. You can update them later under Settings → AI, where DB values take priority. The AI provider is OpenAI-compatible — point `OPENAI_BASE_URL` at OpenAI cloud or any local runtime's `/v1` endpoint (vLLM/LM Studio …).
> - If you are running a local model server on a Linux host, the `extra_hosts` entry is required so the container can reach it via `host.docker.internal`. On Mac/Windows Docker Desktop it resolves automatically and can be omitted.
