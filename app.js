
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const cfg = window.FG_CONFIG || {};

  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.startsWith("YOUR_") &&
    !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_");

  const db = configured && window.supabase
    ? window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY
      )
    : null;

  let mods = [];
  let session = null;

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));

  const msg = (id, text, success = false) => {
    if (!$ (id)) return;
    $(id).textContent = text;
    $(id).className = "message " + (success ? "success" : "");
  };

  $("year").textContent = new Date().getFullYear();

  // Load JSZip automatically
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

      script.onload = () => {
        if (window.JSZip) resolve(window.JSZip);
        else reject(new Error("ZIP library could not load."));
      };

      script.onerror = () =>
        reject(new Error("Could not load ZIP converter."));

      document.head.appendChild(script);
    });
  }

  // Admin modal
  function showModal() {
    $("adminModal").classList.remove("hidden");
  }

  function hideModal() {
    $("adminModal").classList.add("hidden");
  }

  $("adminOpen").onclick = showModal;
  $("closeAdmin").onclick = hideModal;

  $("adminModal").addEventListener("click", e => {
    if (e.target === $("adminModal")) hideModal();
  });

  // Render mods
  function render() {
    const q = $("search").value.toLowerCase();
    const loader = $("loaderFilter").value;

    const list = mods.filter(m =>
      (!loader || m.loader === loader) &&
      (
        (m.name || "") + " " +
        (m.description || "") + " " +
        (m.category || "")
      ).toLowerCase().includes(q)
    );

    $("modCount").textContent = mods.length + " mods";

    $("modGrid").innerHTML = list.length
      ? list.map(m => `
        <article class="mod-card">
          <div class="card-top">
            <span class="tag">${esc(m.loader)}</span>
            <span class="tag">${esc(m.category || "Minecraft Mod")}</span>
          </div>

          <h3>${esc(m.name)}</h3>
          <p>${esc(m.description)}</p>

          <div class="meta">
            <span>Mod ${esc(m.version)}</span>
            <span>Minecraft ${esc(m.minecraft_version)}</span>
          </div>

          <div class="card-actions">
            <a class="primary download"
               href="${esc(m.download_url)}"
               target="_blank"
               rel="noopener">
               Download JAR ↗
            </a>

            ${session ? `
              <button class="danger delete"
                data-id="${esc(m.id)}">
                Delete
              </button>
            ` : ""}
          </div>
        </article>
      `).join("")
      : '<div class="empty">No mods found yet. Check back soon.</div>';

    document.querySelectorAll(".delete").forEach(button => {
      button.onclick = () => removeMod(button.dataset.id);
    });
  }

  // Load database mods
  async function loadMods() {
    if (!db) {
      $("modGrid").innerHTML =
        '<div class="empty">Supabase setup is required.</div>';
      $("modCount").textContent = "Setup needed";
      return;
    }

    const { data, error } = await db
      .from("mods")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Load mods error:", error);
      $("modGrid").innerHTML =
        '<div class="empty">Could not load mods. Check database permissions.</div>';
      return;
    }

    mods = data || [];
    render();
  }

  $("search").oninput = render;
  $("loaderFilter").onchange = render;
  $("refreshMods").onclick = loadMods;

  // Admin login
  $("loginForm").onsubmit = async e => {
    e.preventDefault();

    if (!db) {
      msg("loginMessage", "Finish Supabase setup first.");
      return;
    }

    const { data, error } = await db.auth.signInWithPassword({
      email: $("email").value,
      password: $("password").value
    });

    if (error) {
      msg("loginMessage", error.message);
      return;
    }

    session = data.session;
    await checkAdmin();
  };

  // Verify admin
  async function checkAdmin() {
    if (!session) {
      $("loginPanel").classList.remove("hidden");
      $("dashboard").classList.add("hidden");
      return;
    }

    const { data, error } = await db
      .from("admins")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !data) {
      console.error("Admin check error:", error);

      await db.auth.signOut();
      session = null;

      msg(
        "loginMessage",
        error ? error.message : "This account is not an admin."
      );

      $("loginPanel").classList.remove("hidden");
      $("dashboard").classList.add("hidden");
      return;
    }

    $("loginPanel").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
  }

  // Logout
  $("logout").onclick = async () => {
    await db.auth.signOut();
    session = null;

    $("dashboard").classList.add("hidden");
    $("loginPanel").classList.remove("hidden");

    render();
  };

  // ZIP to JAR upload
  $("uploadForm").onsubmit = async e => {
    e.preventDefault();

    if (!session) {
      msg("uploadMessage", "Please sign in again.");
      return;
    }

    const file = $("modFile").files[0];

    if (!file) {
      msg("uploadMessage", "Choose a ZIP file.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".zip")) {
      msg("uploadMessage", "Only ZIP files are allowed.");
      return;
    }

    $("uploadButton").disabled = true;

    let uploadedPath = null;

    try {
      msg("uploadMessage", "Loading ZIP converter...");

      const JSZip = await loadJSZip();

      msg("uploadMessage", "Opening ZIP file...");

      const outerZip = await JSZip.loadAsync(file);

      const jarFiles = Object.values(outerZip.files).filter(
        item =>
          !item.dir &&
          item.name.toLowerCase().endsWith(".jar")
      );

      if (jarFiles.length !== 1) {
        throw new Error(
          "ZIP must contain exactly one JAR file."
        );
      }

      msg("uploadMessage", "Extracting JAR...");

      const jarEntry = jarFiles[0];
      const jarBlob = await jarEntry.async("blob");

      if (!jarBlob.size) {
        throw new Error("The JAR file is empty.");
      }

      // Verify that the extracted JAR is a readable ZIP archive
      const jarZip = await JSZip.loadAsync(jarBlob);

      const jarContents = Object.values(jarZip.files).filter(
        item => !item.dir
      );

      if (!jarContents.length) {
        throw new Error("The JAR archive is empty.");
      }

      const originalName = jarEntry.name.split("/").pop();

      const safeName = originalName.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

      uploadedPath =
        `${session.user.id}/${Date.now()}-${safeName}`;

      msg("uploadMessage", "Uploading extracted JAR...");

      const { error: uploadError } = await db.storage
        .from("FGPRONEX BUCKET")
        .upload(uploadedPath, jarBlob, {
          upsert: false,
          contentType: "application/java-archive"
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = db.storage
        .from("FGPRONEX BUCKET")
        .getPublicUrl(uploadedPath);

      const row = {
        name: $("modName").value.trim(),
        description: $("description").value.trim(),
        version: $("version").value.trim(),
        minecraft_version: $("mcVersion").value.trim(),
        loader: $("loader").value,
        category: $("category").value.trim(),
        file_path: uploadedPath,
        download_url: urlData.publicUrl,
        created_by: session.user.id
      };

      msg("uploadMessage", "Saving mod information...");

      const { error: databaseError } = await db
        .from("mods")
        .insert(row);

      if (databaseError) throw databaseError;

      uploadedPath = null;

      msg(
        "uploadMessage",
        "JAR Mod uploaded successfully!",
        true
      );

      $("uploadForm").reset();

      await loadMods();

    } catch (error) {
      console.error("Mod upload error:", error);

      if (uploadedPath) {
        const { error: cleanupError } = await db.storage
          .from("FGPRONEX BUCKET")
          .remove([uploadedPath]);

        if (cleanupError) {
          console.error("Cleanup error:", cleanupError);
        }
      }

      msg(
        "uploadMessage",
        error.message || "Upload failed."
      );

    } finally {
      $("uploadButton").disabled = false;
    }
  };

  // Delete mod
  async function removeMod(id) {
    if (!confirm("Delete this mod from the library?")) return;

    const mod = mods.find(m => String(m.id) === String(id));

    const { error } = await db
      .from("mods")
      .delete()
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    if (mod && mod.file_path) {
      const { error: storageError } = await db.storage
        .from("FGPRONEX BUCKET")
        .remove([mod.file_path]);

      if (storageError) {
        console.error("Storage delete error:", storageError);
      }
    }

    await loadMods();
  }

  // Initialize website
  async function init() {
    if (db) {
      const { data } = await db.auth.getSession();

      session = data.session;

      await checkAdmin();

      db.auth.onAuthStateChange((_event, newSession) => {
        session = newSession;
        checkAdmin();
        render();
      });
    }

    await loadMods();
  }

  init();

})();
 
