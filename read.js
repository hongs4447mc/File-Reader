const appStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #20232a; background: #f5f6fa; }
  button, input { font: inherit; }
  button { cursor: pointer; }
  .app { min-height: 100vh; display: grid; grid-template-columns: 280px 1fr; }
  aside { padding: 24px 18px; background: white; border-right: 1px solid #e6e8ee; }
  h1 { margin: 0 0 4px; font-size: 21px; }
  .subtle { color: #737987; font-size: 13px; }
  .upload { display: block; margin: 22px 0; padding: 14px; text-align: center; border: 2px dashed #cbd0dc; border-radius: 12px; color: #555f73; cursor: pointer; }
  .upload:hover, .upload.dragging { border-color: #6757e8; background: #f7f5ff; }
  .upload input { display: none; }
  .files-title { margin: 28px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #737987; }
  .file-list { display: grid; gap: 5px; }
  .file-item { width: 100%; padding: 10px; text-align: left; border: 0; border-radius: 8px; background: transparent; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333; }
  .file-item:hover, .file-item.active { background: #f0efff; color: #5141d6; }
  main { min-width: 0; padding: 28px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .toolbar button { padding: 8px 13px; border: 1px solid #dfe2e9; border-radius: 8px; background: white; }
  .toolbar button:disabled { opacity: .45; cursor: default; }
  .page-count { color: #737987; font-size: 13px; }
  .reader { min-height: 70vh; padding: clamp(20px, 5vw, 56px); border: 1px solid #e6e8ee; border-radius: 14px; background: white; box-shadow: 0 5px 20px #20232a08; }
  .reader pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 15px/1.8 ui-monospace, monospace; }
  .reader img { display: block; max-width: 100%; max-height: 75vh; margin: auto; object-fit: contain; }
  .empty { display: grid; min-height: 60vh; place-items: center; text-align: center; color: #737987; }
  .empty strong { display: block; margin-bottom: 8px; color: #303440; font-size: 20px; }
  @media (max-width: 700px) {
    .app { grid-template-columns: 1fr; }
    aside { border-right: 0; border-bottom: 1px solid #e6e8ee; }
    main { padding: 16px; }
    .file-list { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
  }
`;

document.head.insertAdjacentHTML("beforeend", `<style>${appStyles}</style>`);
document.body.innerHTML = `
  <div class="app">
    <aside>
      <h1>Easy Reader</h1>
      <div class="subtle">Your files, ready to read.</div>
      <label class="upload" id="dropZone">
        <input id="fileInput" type="file" multiple accept=".pdf,.txt,.md,.markdown,.log,.csv,.json,.png,.jpg,.jpeg,.gif,.webp,.bmp">
        <strong>＋ Add files</strong><br>
        <span class="subtle">or drag and drop them here</span>
      </label>
      <div class="files-title">Your library</div>
      <div class="file-list" id="fileList"></div>
    </aside>
    <main>
      <div class="toolbar">
        <button id="prev" disabled>← Previous</button>
        <span class="page-count" id="pageCount"></span>
        <button id="next" disabled>Next →</button>
      </div>
      <section class="reader" id="reader">
        <div class="empty"><div><strong>Welcome to Easy Reader</strong>Upload a PDF, text file, or image to get started.</div></div>
      </section>
    </main>
  </div>
`;

const fileInput = document.querySelector("#fileInput");
const fileList = document.querySelector("#fileList");
const reader = document.querySelector("#reader");
const pageCount = document.querySelector("#pageCount");
const prevButton = document.querySelector("#prev");
const nextButton = document.querySelector("#next");
const dropZone = document.querySelector("#dropZone");

let files = [];
let activeIndex = -1;
let pdfDocument = null;
let pdfPage = 1;

// Add before addFiles:
let libraryDbPromise;

function openLibraryDb() {
  if (libraryDbPromise) return libraryDbPromise;

  libraryDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("easy-reader-library", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return libraryDbPromise;
}

function fileId(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

async function saveToLibrary(file) {
  const db = await openLibraryDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite");
    transaction.objectStore("files").put({
      id: fileId(file),
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      blob: file
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function restoreLibrary() {
  try {
    const db = await openLibraryDb();
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction("files").objectStore("files").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    files = records.map((record) =>
      new File([record.blob], record.name, {
        type: record.type,
        lastModified: record.lastModified
      })
    );

    renderFileList();
    if (files.length) openFile(0);
  } catch (error) {
    console.error("Could not restore the saved library:", error);
  }
}

// Replace the existing addFiles function with this:
async function addFiles(newFiles) {
  for (const file of newFiles) {
    if (!files.some((item) => fileId(item) === fileId(file))) {
      files.push(file);
      try {
        await saveToLibrary(file);
      } catch (error) {
        alert(`Could not save "${file.name}" in your library.`);
        console.error(error);
      }
    }
  }

  renderFileList();
  if (activeIndex === -1 && files.length) openFile(0);
}

function renderFileList() {
  fileList.replaceChildren();
  files.forEach((file, index) => {
    const button = document.createElement("button");
    button.className = `file-item${index === activeIndex ? " active" : ""}`;
    button.textContent = file.name;
    button.title = file.name;
    button.addEventListener("click", () => openFile(index));
    fileList.append(button);
  });
}

function setMessage(message) {
  reader.replaceChildren();
  const box = document.createElement("div");
  box.className = "empty";
  box.textContent = message;
  reader.append(box);
}

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (window.pdfJsLoading) return window.pdfJsLoading;

  window.pdfJsLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("Could not load the PDF reader. Check your internet connection."));
    document.head.append(script);
  });

  return window.pdfJsLoading;
}

async function showPdfPage() {
  const page = await pdfDocument.getPage(pdfPage);
  const text = await page.getTextContent();
  const content = text.items.map((item) => item.str).join(" ");

  reader.replaceChildren();
  const pre = document.createElement("pre");
  pre.textContent = content || "(This page has no selectable text.)";
  reader.append(pre);

  pageCount.textContent = `Page ${pdfPage} of ${pdfDocument.numPages}`;
  prevButton.disabled = pdfPage <= 1;
  nextButton.disabled = pdfPage >= pdfDocument.numPages;
}

async function openFile(index) {
  activeIndex = index;
  pdfDocument = null;
  pdfPage = 1;
  renderFileList();

  const file = files[index];
  const name = file.name.toLowerCase();
  pageCount.textContent = "";
  prevButton.disabled = true;
  nextButton.disabled = true;

  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      setMessage("Loading PDF…");
      const pdfjs = await loadPdfJs();
      pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      await showPdfPage();
    } else if (file.type.startsWith("image/")) {
      reader.replaceChildren();
      const image = document.createElement("img");
      image.alt = file.name;
      image.src = URL.createObjectURL(file);
      reader.append(image);
    } else if (
      file.type.startsWith("text/") ||
      /\.(txt|md|markdown|log|csv|json)$/i.test(file.name)
    ) {
      reader.replaceChildren();
      const pre = document.createElement("pre");
      pre.textContent = await file.text();
      reader.append(pre);
    } else {
      setMessage("This file type isn’t supported yet. Try a PDF, text/Markdown file, or image.");
    }
  } catch (error) {
    setMessage(error.message || "Could not open this file.");
  }
}

fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});

prevButton.addEventListener("click", async () => {
  if (pdfDocument && pdfPage > 1) {
    pdfPage--;
    await showPdfPage();
  }
});
nextButton.addEventListener("click", async () => {
  if (pdfDocument && pdfPage < pdfDocument.numPages) {
    pdfPage++;
    await showPdfPage();
  }
});
// ...existing code...
restoreLibrary();