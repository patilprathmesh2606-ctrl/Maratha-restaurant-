/* =========================================================================
   MARATH — staff dashboard (manager + kitchen)
   ========================================================================= */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const money = (n) => Number(n || 0).toFixed(2);
  const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  let staffProfile = null;   // {id, full_name, role}
  let categories = [];
  let dishes = [];
  let orders = [];
  let ordersChannel = null;
  let knownOrderIds = new Set();
  let currency = "₹";

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------------------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------------------
  async function tryLogin() {
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    const errBox = $("#loginError");
    errBox.classList.remove("show");
    if (!email || !password) { errBox.textContent = "Enter your email and password."; errBox.classList.add("show"); return; }

    const btn = $("#loginBtn");
    btn.disabled = true; btn.textContent = "Signing in…";
    const { error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = "Sign in";

    if (error) { errBox.textContent = error.message; errBox.classList.add("show"); return; }
    await afterLogin();
  }

  async function afterLogin() {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return showLogin();

    const { data: staff, error } = await db.from("staff").select("*").eq("id", user.id).single();
    if (error || !staff) {
      $("#loginError").textContent = "This account isn't set up as staff yet. Ask a manager to add you.";
      $("#loginError").classList.add("show");
      await db.auth.signOut();
      return showLogin();
    }
    staffProfile = staff;
    showApp();
  }

  function showLogin() {
    $("#loginScreen").style.display = "flex";
    $("#adminShell").classList.remove("show");
  }

  function showApp() {
    $("#loginScreen").style.display = "none";
    $("#adminShell").classList.add("show");
    $("#staffName").textContent = staffProfile.full_name;
    $("#staffRole").textContent = staffProfile.role;

    const isManager = staffProfile.role === "manager";
    ["navMenu", "navReports", "navSettings"].forEach(id => {
      $("#" + id).style.display = isManager ? "flex" : "none";
    });

    loadSettings();
    loadMenu();
    loadOrders();
    subscribeOrders();
  }

  // ---------------------------------------------------------------------
  // NAV
  // ---------------------------------------------------------------------
  function bindNav() {
    $$(".nav-item[data-view]").forEach(btn => btn.addEventListener("click", () => {
      $$(".nav-item[data-view]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".admin-view").forEach(v => v.classList.remove("active"));
      $("#view-" + btn.dataset.view).classList.add("active");
      if (btn.dataset.view === "reports") loadReport();
    }));
    $("#logoutBtn").addEventListener("click", async () => {
      await db.auth.signOut();
      staffProfile = null;
      if (ordersChannel) { db.removeChannel(ordersChannel); ordersChannel = null; }
      showLogin();
    });
  }

  // =======================================================================
  // ORDERS (kanban)
  // =======================================================================
  const STATUSES = ["pending", "preparing", "ready", "delivered", "completed"];

  async function loadOrders() {
    const since = new Date(); since.setDate(since.getDate() - 1); // last 24h keeps the board relevant
    const { data, error } = await db
      .from("orders")
      .select("*, order_items(*)")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false });
    if (error) { toast("Couldn't load orders"); return; }
    orders = data || [];
    renderKanban();
  }

  function subscribeOrders() {
    ordersChannel = db.channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadOrders())
      .subscribe();
  }

  function renderKanban() {
    const grouped = {};
    STATUSES.forEach(s => grouped[s] = []);
    orders.forEach(o => { if (grouped[o.status]) grouped[o.status].push(o); });

    STATUSES.forEach(status => {
      $("#count-" + status).textContent = grouped[status].length;
      const col = $("#col-" + status);
      col.innerHTML = grouped[status].map(o => orderCardHTML(o)).join("") ||
        `<p style="font-size:12px;color:var(--muted);">No orders</p>`;
    });

    bindOrderActions();

    // flash brand-new pending orders
    const currentIds = new Set(orders.map(o => o.id));
    orders.forEach(o => {
      if (o.status === "pending" && !knownOrderIds.has(o.id) && knownOrderIds.size > 0) {
        const el = document.querySelector(`[data-order-card="${o.id}"]`);
        el?.classList.add("new-order-flash");
      }
    });
    knownOrderIds = currentIds;
  }

  function orderCardHTML(o) {
    const items = (o.order_items || []).map(i => `<li><span>${i.quantity}× ${escapeHTML(i.dish_name)}</span></li>`).join("");
    let actionHTML = "";
    if (o.status === "pending") actionHTML = `<button class="btn btn-olive btn-sm action" data-advance="${o.id}" data-to="preparing">Accept order</button>`;
    else if (o.status === "preparing") actionHTML = `<button class="btn btn-olive btn-sm action" data-advance="${o.id}" data-to="ready">Mark ready</button>`;
    else if (o.status === "ready") actionHTML = `<button class="btn btn-olive btn-sm action" data-advance="${o.id}" data-to="delivered">Mark delivered</button>`;
    else if (o.status === "delivered") actionHTML = `<p style="font-size:11px;color:var(--muted); margin:8px 0 0;">Waiting for customer to confirm receipt</p>`;
    else if (o.status === "completed") actionHTML = `<p style="font-size:11px;color:#3c5a2c; margin:8px 0 0;">✓ Invoiced</p>`;

    const cancelBtn = ["pending", "preparing", "ready"].includes(o.status)
      ? `<button class="btn btn-danger btn-sm action" data-advance="${o.id}" data-to="cancelled">Cancel</button>` : "";

    return `
    <div class="order-card" data-order-card="${o.id}">
      <div class="top"><span>${o.order_number}</span><span>${currency}${money(o.total_amount)}</span></div>
      <div class="cust">${escapeHTML(o.customer_name)}${o.table_number ? " · Table " + escapeHTML(o.table_number) : ""}</div>
      <div class="meta">${new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${o.customer_phone ? " · " + escapeHTML(o.customer_phone) : ""}</div>
      <ul>${items}</ul>
      ${o.notes ? `<div class="meta">Note: ${escapeHTML(o.notes)}</div>` : ""}
      ${actionHTML}
      ${cancelBtn}
    </div>`;
  }

  function bindOrderActions() {
    $$("[data-advance]").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error } = await db.rpc("update_order_status", { p_order_id: btn.dataset.advance, p_new_status: btn.dataset.to });
      if (error) toast(error.message || "Couldn't update order");
      // realtime subscription will reload the board
    }));
  }

  // =======================================================================
  // MENU MANAGEMENT (manager only)
  // =======================================================================
  async function loadMenu() {
    const [{ data: cats }, { data: ds }] = await Promise.all([
      db.from("categories").select("*").order("sort_order"),
      db.from("dishes").select("*").order("sort_order"),
    ]);
    categories = cats || [];
    dishes = ds || [];
    renderCategoryManager();
    renderDishGrid();
    populateDishCategorySelect();
  }

  function renderCategoryManager() {
    $("#catManager").innerHTML = categories.map(c =>
      `<span class="cat-chip">${escapeHTML(c.name)} <button data-delcat="${c.id}" title="Delete category">✕</button></span>`
    ).join("");
    $$("[data-delcat]").forEach(b => b.addEventListener("click", () => deleteCategory(b.dataset.delcat)));
  }

  function populateDishCategorySelect() {
    $("#dishCategory").innerHTML = categories.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join("");
  }

  function renderDishGrid() {
    const byCat = {};
    categories.forEach(c => byCat[c.id] = c.name);
    $("#adminDishGrid").innerHTML = dishes.map(d => `
      <div class="card admin-dish-card">
        ${d.image_url ? `<img src="${d.image_url}" alt="">` : `<div class="ph">No photo</div>`}
        <div class="info">
          <div class="name">${escapeHTML(d.name)}</div>
          <div class="cat">${escapeHTML(byCat[d.category_id] || "Uncategorized")}</div>
          <div class="price">${currency}${money(d.price)}</div>
          <div class="row-actions">
            <button class="pill-toggle ${d.is_available ? "on" : "off"}" data-toggle="${d.id}">${d.is_available ? "Available" : "Hidden"}</button>
            <button class="btn btn-ghost btn-sm" data-edit="${d.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-del="${d.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join("") || `<p style="color:var(--muted);">No dishes yet — add your first one.</p>`;

    $$("[data-toggle]").forEach(b => b.addEventListener("click", () => toggleAvailability(b.dataset.toggle)));
    $$("[data-edit]").forEach(b => b.addEventListener("click", () => openDishModal(b.dataset.edit)));
    $$("[data-del]").forEach(b => b.addEventListener("click", () => deleteDish(b.dataset.del)));
  }

  async function toggleAvailability(id) {
    const d = dishes.find(x => x.id === id);
    const { error } = await db.from("dishes").update({ is_available: !d.is_available, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast(error.message);
    await loadMenu();
  }

  async function deleteDish(id) {
    if (!confirm("Remove this dish from the menu?")) return;
    const { error } = await db.from("dishes").delete().eq("id", id);
    if (error) return toast(error.message);
    toast("Dish removed");
    await loadMenu();
  }

  async function deleteCategory(id) {
    if (!confirm("Delete this category? Dishes in it become uncategorized.")) return;
    const { error } = await db.from("categories").delete().eq("id", id);
    if (error) return toast(error.message);
    await loadMenu();
  }

  $("#addCategoryBtn")?.addEventListener("click", async () => {
    const name = prompt("Category name (e.g. Starters):");
    if (!name) return;
    const { error } = await db.from("categories").insert({ name, sort_order: categories.length + 1 });
    if (error) return toast(error.message);
    await loadMenu();
  });

  // ---- Dish modal ----
  let editingDishId = null;
  let pendingPhotoFile = null;

  function openDishModal(id) {
    editingDishId = id || null;
    pendingPhotoFile = null;
    const d = id ? dishes.find(x => x.id === id) : null;
    $("#dishModalTitle").textContent = d ? "Edit dish" : "Add dish";
    $("#dishName").value = d?.name || "";
    $("#dishDescription").value = d?.description || "";
    $("#dishPrice").value = d?.price ?? "";
    $("#dishCategory").value = d?.category_id || (categories[0]?.id || "");
    $("#dishAvailable").value = String(d?.is_available ?? true);
    $("#dishPhotoFile").value = "";
    if (d?.image_url) {
      $("#dishPhotoPreview").src = d.image_url;
      $("#dishPhotoPreviewWrap").style.display = "block";
    } else {
      $("#dishPhotoPreviewWrap").style.display = "none";
    }
    $("#dishModalOverlay").classList.add("show");
  }
  function closeDishModal() { $("#dishModalOverlay").classList.remove("show"); }

  $("#addDishBtn")?.addEventListener("click", () => openDishModal(null));
  $("#dishModalClose")?.addEventListener("click", closeDishModal);
  $("#dishModalCancel")?.addEventListener("click", closeDishModal);
  $("#dishPhotoFile")?.addEventListener("change", (e) => {
    pendingPhotoFile = e.target.files[0] || null;
    if (pendingPhotoFile) {
      $("#dishPhotoPreview").src = URL.createObjectURL(pendingPhotoFile);
      $("#dishPhotoPreviewWrap").style.display = "block";
    }
  });

  $("#dishModalSave")?.addEventListener("click", async () => {
    const name = $("#dishName").value.trim();
    const price = parseFloat($("#dishPrice").value);
    if (!name || isNaN(price)) { toast("Name and price are required"); return; }

    const btn = $("#dishModalSave");
    btn.disabled = true; btn.textContent = "Saving…";

    let image_url = editingDishId ? (dishes.find(x => x.id === editingDishId)?.image_url || null) : null;
    if (pendingPhotoFile) {
      const path = `${Date.now()}-${pendingPhotoFile.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
      const { error: upErr } = await db.storage.from("dish-images").upload(path, pendingPhotoFile, { upsert: true });
      if (upErr) { toast("Photo upload failed: " + upErr.message); btn.disabled = false; btn.textContent = "Save dish"; return; }
      image_url = db.storage.from("dish-images").getPublicUrl(path).data.publicUrl;
    }

    const payload = {
      name,
      description: $("#dishDescription").value.trim(),
      price,
      category_id: $("#dishCategory").value || null,
      is_available: $("#dishAvailable").value === "true",
      image_url,
      updated_at: new Date().toISOString(),
    };

    const { error } = editingDishId
      ? await db.from("dishes").update(payload).eq("id", editingDishId)
      : await db.from("dishes").insert(payload);

    btn.disabled = false; btn.textContent = "Save dish";
    if (error) return toast(error.message);

    toast("Dish saved");
    closeDishModal();
    await loadMenu();
  });

  // =======================================================================
  // REPORTS (manager only)
  // =======================================================================
  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  async function loadReport() {
    const dateVal = $("#reportDate").value || todayStr();
    $("#reportDate").value = dateVal;
    const start = new Date(dateVal + "T00:00:00");
    const end = new Date(dateVal + "T23:59:59.999");

    const { data, error } = await db
      .from("invoices")
      .select("*, orders(customer_name, order_number)")
      .gte("issued_at", start.toISOString())
      .lte("issued_at", end.toISOString())
      .order("issued_at", { ascending: false });

    if (error) { toast("Couldn't load report"); return; }
    const rows = data || [];

    const subtotal = rows.reduce((s, r) => s + Number(r.subtotal), 0);
    const tax = rows.reduce((s, r) => s + Number(r.tax_amount), 0);
    const total = rows.reduce((s, r) => s + Number(r.total_amount), 0);

    $("#statOrders").textContent = rows.length;
    $("#statSubtotal").textContent = currency + money(subtotal);
    $("#statTax").textContent = currency + money(tax);
    $("#statTotal").textContent = currency + money(total);

    $("#reportTableBody").innerHTML = rows.map(r => `
      <tr style="border-top:1px solid var(--line);">
        <td style="padding:10px 16px;">${r.invoice_number}</td>
        <td style="padding:10px 16px;">${escapeHTML(r.orders?.customer_name || "—")}</td>
        <td style="padding:10px 16px; text-align:right; font-family:var(--font-mono);">${money(r.subtotal)}</td>
        <td style="padding:10px 16px; text-align:right; font-family:var(--font-mono);">${money(r.tax_amount)}</td>
        <td style="padding:10px 16px; text-align:right; font-family:var(--font-mono); font-weight:700;">${money(r.total_amount)}</td>
        <td style="padding:10px 16px; text-align:right;">${new Date(r.issued_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" style="padding:20px 16px; color:var(--muted);">No completed orders for this day yet.</td></tr>`;
  }

  $("#reportDate")?.addEventListener("change", loadReport);
  $("#reportTodayBtn")?.addEventListener("click", () => { $("#reportDate").value = todayStr(); loadReport(); });

  // =======================================================================
  // SETTINGS (manager only)
  // =======================================================================
  async function loadSettings() {
    const { data } = await db.from("restaurant_settings").select("*").eq("id", 1).single();
    if (!data) return;
    currency = data.currency_symbol || "₹";
    $("#setName").value = data.restaurant_name || "";
    $("#setTax").value = data.tax_rate ?? 5;
    $("#setTagline").value = data.tagline || "";
    $("#setOpen").value = data.opens_at || "";
    $("#setClose").value = data.closes_at || "";
    $("#setAddress").value = data.address || "";
    $("#setPhone").value = data.phone || "";
    $("#setInstagram").value = data.social_instagram || "";
    $("#setFacebook").value = data.social_facebook || "";
    $("#setWhatsapp").value = data.social_whatsapp || "";
    $("#setTwitter").value = data.social_twitter || "";
    $("#setYoutube").value = data.social_youtube || "";
  }

  $("#saveSettingsBtn")?.addEventListener("click", async () => {
    const payload = {
      restaurant_name: $("#setName").value.trim(),
      tax_rate: parseFloat($("#setTax").value) || 0,
      tagline: $("#setTagline").value.trim(),
      opens_at: $("#setOpen").value.trim(),
      closes_at: $("#setClose").value.trim(),
      address: $("#setAddress").value.trim(),
      phone: $("#setPhone").value.trim(),
      social_instagram: $("#setInstagram").value.trim(),
      social_facebook: $("#setFacebook").value.trim(),
      social_whatsapp: $("#setWhatsapp").value.trim(),
      social_twitter: $("#setTwitter").value.trim(),
      social_youtube: $("#setYoutube").value.trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("restaurant_settings").update(payload).eq("id", 1);
    if (error) return toast(error.message);
    currency = $("#setName").value ? currency : currency;
    $("#settingsSaved").style.display = "inline";
    setTimeout(() => $("#settingsSaved").style.display = "none", 2000);
    toast("Settings saved");
  });

  // ---------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    bindNav();
    $("#loginBtn").addEventListener("click", tryLogin);
    $("#loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
    $("#reportDate").value = todayStr();

    const { data: { session } } = await db.auth.getSession();
    if (session) await afterLogin();
    else showLogin();
  });
})();
