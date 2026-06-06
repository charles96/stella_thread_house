type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'id' | 'fr' | 'de';

const MSGS = {
  ko: {
    tavilyUnavailable: 'Tavily 사용 불가 — 검색 없이 응답합니다',
    urlDetect: (n: number) => `URL 감지 — 페이지 ${n}개 직접 읽는 중…`,
    botBlocked: '봇 차단 감지 — Tavily 로 본문 가져오는 중…',
    urlAllFailed: 'URL 페이지 읽기에 모두 실패했습니다',
    urlError: (msg: string) => `URL 처리 실패: ${msg}`,
    analyzing: '검색 의도 분석 중…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily 웹 검색 (${n}건) — ${queries}`,
    searchingSingle: (q: string) => `Tavily 웹 검색 중 — "${q}"`,
    noResults: '검색 결과 없음',
    extractingPages: (n: number) =>
      `Tavily 결과 상위 ${n}개 페이지 본문 추출 중…`,
    contextOverflow:
      '모델의 컨텍스트 한도를 초과했습니다. 컨텍스트가 더 큰 모델로 변경하거나, 설정에서 **웹검색 문서 수** 옵션을 줄여 주세요.',
    aiConfigError:
      'AI 설정에 오류가 있습니다. **설정**에서 AI 공급자·엔드포인트·API 키를 확인해 주세요.',
    visionUnsupported:
      'Vision(이미지)을 지원하지 않는 모델입니다. **설정**에서 이미지를 지원하는 모델로 변경하세요.',
    modelNotFound:
      '선택한 AI 모델을 찾을 수 없습니다. **설정**에서 유효한 모델로 변경하세요.',
  },
  en: {
    tavilyUnavailable: 'Tavily unavailable — responding without search',
    urlDetect: (n: number) => `URL detected — reading ${n} page${n === 1 ? '' : 's'}…`,
    botBlocked: 'Bot block detected — fetching content via Tavily…',
    urlAllFailed: 'All URL pages failed to load',
    urlError: (msg: string) => `URL error: ${msg}`,
    analyzing: 'Analyzing search intent…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily web search (${n} quer${n === 1 ? 'y' : 'ies'}) — ${queries}`,
    searchingSingle: (q: string) => `Searching the web — "${q}"`,
    noResults: 'No search results found',
    extractingPages: (n: number) =>
      `Extracting top ${n} page${n === 1 ? '' : 's'} from Tavily results…`,
    contextOverflow:
      'The model\'s context limit was exceeded. Switch to a model with a larger context, or lower the **Web search document count** option in Settings.',
    aiConfigError:
      'There is a problem with the AI configuration. Please check the AI provider, endpoint, and API key in **Settings**.',
    visionUnsupported:
      'This model does not support image (vision) inputs. Switch to a vision-capable model in **Settings**.',
    modelNotFound:
      'The selected AI model was not found. Choose a valid model in **Settings**.',
  },
  ja: {
    tavilyUnavailable: 'Tavily 利用不可 — 検索なしで回答します',
    urlDetect: (n: number) => `URL検出 — ${n}ページを読み込み中…`,
    botBlocked: 'ボットブロック検出 — Tavilyで本文取得中…',
    urlAllFailed: 'URLページの読み込みがすべて失敗しました',
    urlError: (msg: string) => `URL処理失敗: ${msg}`,
    analyzing: '検索意図を分析中…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily ウェブ検索 (${n}件) — ${queries}`,
    searchingSingle: (q: string) => `ウェブ検索中 — "${q}"`,
    noResults: '検索結果なし',
    extractingPages: (n: number) =>
      `Tavily結果上位${n}ページの本文を抽出中…`,
    contextOverflow:
      'モデルのコンテキスト上限を超えました。より大きなコンテキストのモデルに変更するか、設定の **ウェブ検索文書数** オプションを減らしてください。',
    aiConfigError:
      'AI 設定にエラーがあります。**設定（Settings）** で AI プロバイダー・エンドポイント・API キーを確認してください。',
    visionUnsupported:
      'このモデルは画像（Vision）入力に対応していません。**設定** で画像対応モデルに変更してください。',
    modelNotFound:
      '選択した AI モデルが見つかりません。**設定** で有効なモデルに変更してください。',
  },
  zh: {
    tavilyUnavailable: 'Tavily 不可用 — 将在不搜索的情况下回答',
    urlDetect: (n: number) => `检测到URL — 正在读取 ${n} 个页面…`,
    botBlocked: '检测到机器人拦截 — 正在通过Tavily获取内容…',
    urlAllFailed: 'URL页面读取全部失败',
    urlError: (msg: string) => `URL处理失败: ${msg}`,
    analyzing: '正在分析搜索意图…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily网络搜索 (${n}条) — ${queries}`,
    searchingSingle: (q: string) => `正在搜索网络 — "${q}"`,
    noResults: '没有搜索结果',
    extractingPages: (n: number) => `正在提取Tavily结果前${n}个页面内容…`,
    contextOverflow:
      '超出模型的上下文长度限制。请改用上下文更大的模型，或在设置中调低 **网络搜索文档数** 选项。',
    aiConfigError:
      'AI 配置存在错误。请在 **设置（Settings）** 中检查 AI 提供商、端点和 API 密钥。',
    visionUnsupported:
      '该模型不支持图像（Vision）输入。请在 **设置** 中切换为支持图像的模型。',
    modelNotFound:
      '找不到所选的 AI 模型。请在 **设置** 中选择有效的模型。',
  },
  id: {
    tavilyUnavailable: 'Tavily tidak tersedia — menjawab tanpa pencarian',
    urlDetect: (n: number) => `URL terdeteksi — membaca ${n} halaman…`,
    botBlocked: 'Deteksi blokir bot — mengambil konten via Tavily…',
    urlAllFailed: 'Semua halaman URL gagal dibaca',
    urlError: (msg: string) => `Gagal memproses URL: ${msg}`,
    analyzing: 'Menganalisis maksud pencarian…',
    searchingMulti: (n: number, queries: string) =>
      `Pencarian web Tavily (${n} kueri) — ${queries}`,
    searchingSingle: (q: string) => `Mencari di web — "${q}"`,
    noResults: 'Tidak ada hasil pencarian',
    extractingPages: (n: number) =>
      `Mengekstrak ${n} halaman teratas dari hasil Tavily…`,
    contextOverflow:
      'Batas konteks model terlampaui. Gunakan model dengan konteks lebih besar, atau kurangi opsi **Jumlah dokumen pencarian web** di Pengaturan.',
    aiConfigError:
      'Ada masalah pada konfigurasi AI. Periksa penyedia AI, endpoint, dan kunci API di **Pengaturan**.',
    visionUnsupported:
      'Model ini tidak mendukung input gambar (Vision). Ganti ke model yang mendukung gambar di **Pengaturan**.',
    modelNotFound:
      'Model AI yang dipilih tidak ditemukan. Pilih model yang valid di **Pengaturan**.',
  },
  fr: {
    tavilyUnavailable: 'Tavily indisponible — réponse sans recherche',
    urlDetect: (n: number) =>
      `URL détectée — lecture de ${n} page${n === 1 ? '' : 's'}…`,
    botBlocked: 'Blocage de bot détecté — récupération du contenu via Tavily…',
    urlAllFailed: 'Échec du chargement de toutes les pages URL',
    urlError: (msg: string) => `Erreur d'URL : ${msg}`,
    analyzing: 'Analyse de l\'intention de recherche…',
    searchingMulti: (n: number, queries: string) =>
      `Recherche web Tavily (${n} requête${n === 1 ? '' : 's'}) — ${queries}`,
    searchingSingle: (q: string) => `Recherche sur le web — « ${q} »`,
    noResults: 'Aucun résultat de recherche',
    extractingPages: (n: number) =>
      `Extraction des ${n} première${n === 1 ? '' : 's'} page${n === 1 ? '' : 's'} des résultats Tavily…`,
    contextOverflow:
      'La limite de contexte du modèle a été dépassée. Passez à un modèle avec un contexte plus grand, ou réduisez l\'option **Nombre de documents de recherche web** dans les Paramètres.',
    aiConfigError:
      'Un problème est survenu avec la configuration de l\'IA. Veuillez vérifier le fournisseur d\'IA, le point de terminaison et la clé API dans les **Paramètres**.',
    visionUnsupported:
      'Ce modèle ne prend pas en charge les images (vision). Passez à un modèle compatible vision dans les **Paramètres**.',
    modelNotFound:
      'Le modèle d\'IA sélectionné est introuvable. Choisissez un modèle valide dans les **Paramètres**.',
  },
  de: {
    tavilyUnavailable: 'Tavily nicht verfügbar — Antwort ohne Suche',
    urlDetect: (n: number) =>
      `URL erkannt — ${n} Seite${n === 1 ? '' : 'n'} werden gelesen…`,
    botBlocked: 'Bot-Blockierung erkannt — Inhalt wird über Tavily abgerufen…',
    urlAllFailed: 'Alle URL-Seiten konnten nicht geladen werden',
    urlError: (msg: string) => `URL-Fehler: ${msg}`,
    analyzing: 'Suchabsicht wird analysiert…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily-Websuche (${n} Anfrage${n === 1 ? '' : 'n'}) — ${queries}`,
    searchingSingle: (q: string) => `Websuche — „${q}"`,
    noResults: 'Keine Suchergebnisse',
    extractingPages: (n: number) =>
      `Top-${n}-Seite${n === 1 ? '' : 'n'} aus den Tavily-Ergebnissen werden extrahiert…`,
    contextOverflow:
      'Das Kontextlimit des Modells wurde überschritten. Wechseln Sie zu einem Modell mit größerem Kontext oder verringern Sie die Option **Anzahl der Websuche-Dokumente** in den Einstellungen.',
    aiConfigError:
      'Es gibt ein Problem mit der AI-Konfiguration. Bitte überprüfen Sie den AI-Anbieter, den Endpunkt und den API-Schlüssel in den **Einstellungen**.',
    visionUnsupported:
      'Dieses Modell unterstützt keine Bildeingaben (Vision). Wechseln Sie in den **Einstellungen** zu einem Vision-fähigen Modell.',
    modelNotFound:
      'Das ausgewählte AI-Modell wurde nicht gefunden. Wählen Sie in den **Einstellungen** ein gültiges Modell.',
  },
} as const;

export function statusMsg(locale: string | undefined) {
  const l: Locale =
    locale && (locale as Locale) in MSGS ? (locale as Locale) : 'ko';
  return MSGS[l];
}
