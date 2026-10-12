
/* ==========================================
   GARAGEM ONLINE — ANJOSENERGY
   Aplicação empresarial
   ========================================== */

const SUPABASE_URL =
  "https://bsnbjpenrsubqoatqqne.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_Pn01p8lXk3oomJ2urIU-qA_E7dEvuFR";

let db = null;
let currentUser = null;
let currentProfile = null;
let vehicles = [];
let selectedVehicle = null;
let maintenanceRecords = [];

/* ---------- Elementos e mensagens ---------- */

const $ = (id) => document.getElementById(id);

function notify(message, type = "info") {
  const target = $("status") || $("loginStatus");

  if (target) {
    target.textContent = message;
    target.className =
      "status " +
      (type === "error" ? "text-danger" :
       type === "success" ? "text-success" : "");
    target.hidden = false;
  }

  console.log(`[${type}] ${message}`);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function isMaster() {
  return currentProfile?.role === "master";
}

function showLoggedOut() {
  $("loginPanel")?.classList.remove("hidden");
  $("appView")?.classList.add("hidden");
  $("userBadge") && ($("userBadge").textContent = "");
  $("authToggle") && ($("authToggle").textContent = "Entrar");
}

function showLoggedIn() {
  $("loginPanel")?.classList.add("hidden");
  $("appView")?.classList.remove("hidden");
  $("userBadge") && (
    $("userBadge").textContent =
      currentProfile?.full_name ||
      currentProfile?.email ||
      currentUser?.email ||
      ""
  );
  $("authToggle") && ($("authToggle").textContent = "Sair");

  $("roleLabel") && (
    $("roleLabel").textContent =
      isMaster() ? "Master" : "Mecânico"
  );

  document.querySelectorAll(".masterOnly").forEach((element) => {
    element.classList.toggle("hidden", !isMaster());
  });
}

/* ---------- Inicialização ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  if (!window.supabase?.createClient) {
    notify("Não foi possível carregar a biblioteca Supabase.", "error");
    return;
  }

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  bindEvents();

  const { data, error } = await db.auth.getSession();

  if (error) {
    notify("Erro ao recuperar a sessão: " + error.message, "error");
    showLoggedOut();
    return;
  }

  if (data.session?.user) {
    await loadProfile(data.session.user);
  } else {
    showLoggedOut();
  }

  db.auth.onAuthStateChange((_event, session) => {
    setTimeout(async () => {
      if (session?.user) {
        await loadProfile(session.user);
      } else {
        currentUser = null;
        currentProfile = null;
        vehicles = [];
        selectedVehicle = null;
        showLoggedOut();
      }
    }, 0);
  });

  // Ficha pública aberta por um endereço com ?vehicle=...
  const params = new URLSearchParams(location.search);
  const publicCode = params.get("vehicle");

  if (publicCode) {
    await showPublicVehicle(publicCode);
  }
});

/* ---------- Autenticação ---------- */

function bindEvents() {
  $("loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("loginForm").querySelector('[type="submit"]');
    if (button) button.disabled = true;

    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });

    if (button) button.disabled = false;

    if (error) {
      notify("Falha no login. Confirma as credenciais e a conta.", "error");
    }
  });

  $("authToggle")?.addEventListener("click", async () => {
    if (!currentUser) {
      $("loginPanel")?.scrollIntoView({ behavior: "smooth" });
      $("email")?.focus();
      return;
    }

    const { error } = await db.auth.signOut();
    if (error) notify("Não foi possível terminar a sessão.", "error");
  });

  $("newVehicleBtn")?.addEventListener("click", () => {
    if (!isMaster()) return notify("Apenas o Master pode criar veículos.", "error");
    resetVehicleForm();
    $("vehicleForm")?.classList.remove("hidden");
    $("vehicleForm")?.scrollIntoView({ behavior: "smooth" });
  });

  $("cancelVehicle")?.addEventListener("click", resetVehicleForm);

  $("vehicleForm")?.addEventListener("submit", saveVehicle);

  $("addMaintenanceBtn")?.addEventListener("click", () => {
    if (!selectedVehicle) return;
    $("maintenanceForm")?.classList.remove("hidden");
    $("maintenanceForm")?.scrollIntoView({ behavior: "smooth" });
  });

  $("cancelMaintenance")?.addEventListener("click", () => {
    $("maintenanceForm")?.reset();
    $("maintenanceId").value = "";
    $("maintenanceForm")?.classList.add("hidden");
  });

  $("maintenanceForm")?.addEventListener("submit", saveMaintenance);

  $("closeQr")?.addEventListener("click", () => $("qrDialog")?.close());

  $("copyQrUrl")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("qrUrl").value);
      notify("Endereço copiado.", "success");
    } catch {
      $("qrUrl")?.select();
      notify("Seleciona e copia o endereço manualmente.");
    }
  });

  $("printQr")?.addEventListener("click", () => window.print());

  $("openPublic")?.addEventListener("click", () => {
    if ($("qrUrl")?.value) window.open($("qrUrl").value, "_blank");
  });

  $("refreshTeam")?.addEventListener("click", () => {
    notify("A gestão da equipa será ligada depois de confirmar as funções SQL.");
  });
}

async function loadProfile(user) {
  currentUser = user;

  const { data, error } = await db
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    currentProfile = null;
    showLoggedOut();
    notify(
      error ? "Erro ao carregar perfil: " + error.message :
      "Esta conta não tem perfil associado.",
      "error"
    );
    return;
  }

  currentProfile = data;
  showLoggedIn();
  await loadVehicles();
}

/* ---------- Veículos ---------- */

async function loadVehicles() {
  const { data, error } = await db
    .from("vehicles")
    .select("*")
    .order("make", { ascending: true });

  if (error) {
    notify("Erro ao carregar veículos: " + error.message, "error");
    return;
  }

  vehicles = data || [];
  renderVehicles();
  renderAlerts();

  if (selectedVehicle) {
    const updated = vehicles.find(v => v.id === selectedVehicle.id);
    if (updated) {
      selectedVehicle = updated;
      await loadMaintenance(updated);
    } else {
      selectedVehicle = null;
      $("maintenancePanel")?.classList.add("hidden");
    }
  }
}

function renderVehicles() {
  $("vehicleCount") && ($("vehicleCount").textContent = vehicles.length);

  const list = $("vehicleList");
  if (!list) return;

  if (!vehicles.length) {
    list.innerHTML = '<p class="muted">Ainda não existem veículos registados.</p>';
    return;
  }

  list.innerHTML = vehicles.map(v => `
    <article class="panel vehicle-card">
      <p class="eyebrow">${escapeHTML(v.code || "FROTA")}</p>
      <h3>${escapeHTML(v.make)} ${escapeHTML(v.model)}</h3>
      <p>Matrícula: <strong>${escapeHTML(v.plate || "—")}</strong></p>
      <p>Quilometragem: ${escapeHTML(v.current_km ?? 0)} km</p>
      <p>IPO: ${escapeHTML(v.ipo_due_date || "Não indicada")}</p>
      <div class="actions">
        <button data-action="select" data-id="${escapeHTML(v.id)}">Manutenção</button>
        ${isMaster() ? `
          <button class="secondary" data-action="edit" data-id="${escapeHTML(v.id)}">Editar</button>
          <button class="secondary" data-action="qr" data-id="${escapeHTML(v.id)}">Ficha / QR</button>
        ` : ""}
      </div>
    </article>
  `).join("");

  list.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", async () => {
      const vehicle = vehicles.find(v => String(v.id) === button.dataset.id);
      if (!vehicle) return;

      if (button.dataset.action === "select") {
        selectedVehicle = vehicle;
        $("maintenancePanel")?.classList.remove("hidden");
        $("maintenanceHeading").textContent =
          `Manutenção — ${vehicle.make} ${vehicle.model}`;
        $("maintenanceForm")?.classList.add("hidden");
        await loadMaintenance(vehicle);
      }

      if (button.dataset.action === "edit" && isMaster()) {
        fillVehicleForm(vehicle);
      }

      if (button.dataset.action === "qr" && isMaster()) {
        openQr(vehicle);
      }
    });
  });
}

function fillVehicleForm(v) {
  $("vehicleId").value = v.id || "";
  $("make").value = v.make || "";
  $("model").value = v.model || "";
  $("plate").value = v.plate || "";
  $("year").value = v.year || "";
  $("engine").value = v.engine || "";
  $("fuel").value = v.fuel || "";
  $("currentKm").value = v.current_km ?? "";
  $("ipoDueDate").value = v.ipo_due_date || "";
  $("code").value = v.code || "";
  $("publicDescription").value = v.public_description || "";
  $("privateNotes").value = v.private_notes || "";

  $("vehicleFormTitle").textContent = "Editar veículo";
  $("vehicleForm").classList.remove("hidden");
  $("vehicleForm").scrollIntoView({ behavior: "smooth" });
}

function resetVehicleForm() {
  $("vehicleForm")?.reset();
  if ($("vehicleId")) $("vehicleId").value = "";
  if ($("vehicleFormTitle")) $("vehicleFormTitle").textContent = "Novo veículo";
  $("vehicleForm")?.classList.add("hidden");
}

async function saveVehicle(event) {
  event.preventDefault();

  if (!isMaster()) return notify("Sem permissões para alterar veículos.", "error");

  const id = $("vehicleId").value;

  const record = {
    make: $("make").value.trim(),
    model: $("model").value.trim(),
    plate: $("plate").value.trim() || null,
    year: $("year").value ? Number($("year").value) : null,
    engine: $("engine").value.trim() || null,
    fuel: $("fuel").value.trim() || null,
    current_km: $("currentKm").value ? Number($("currentKm").value) : 0,
    ipo_due_date: $("ipoDueDate").value || null,
    code: $("code").value.trim() || null,
    public_description: $("publicDescription").value.trim() || null,
    private_notes: $("privateNotes").value.trim() || null
  };

  const query = id
    ? db.from("vehicles").update(record).eq("id", id)
    : db.from("vehicles").insert({ ...record, owner_id: currentUser.id });

  const { error } = await query;

  if (error) {
    notify("Não foi possível guardar o veículo: " + error.message, "error");
    return;
  }

  notify("Veículo guardado.", "success");
  resetVehicleForm();
  await loadVehicles();
}

/* ---------- Manutenções ---------- */

async function loadMaintenance(vehicle) {
  const { data, error } = await db
    .from("maintenance_records")
    .select("*")
    .eq("vehicle_id", vehicle.id)
    .order("service_date", { ascending: false });

  if (error) {
    notify("Erro ao carregar manutenções: " + error.message, "error");
    return;
  }

  maintenanceRecords = data || [];
  renderMaintenance();
}

function renderMaintenance() {
  const list = $("maintenanceList");
  if (!list) return;

  if (!maintenanceRecords.length) {
    list.innerHTML = '<p class="muted">Sem intervenções registadas.</p>';
    return;
  }

  list.innerHTML = maintenanceRecords.map(r => `
    <article class="panel maintenance-card">
      <h3>${escapeHTML(r.title)}</h3>
      <p>Data: ${escapeHTML(r.service_date || "—")} · ${escapeHTML(r.odometer_km ?? "—")} km</p>
      <p>Categoria: ${escapeHTML(r.category || "—")}</p>
      <p>Custo: ${r.cost_eur == null ? "—" : escapeHTML(Number(r.cost_eur).toFixed(2) + " €")}</p>
      <p>${escapeHTML(r.parts_public || "")}</p>
      ${isMaster() ? `<p>Notas internas: ${escapeHTML(r.notes_private || "—")}</p>` : ""}
    </article>
  `).join("");
}

async function saveMaintenance(event) {
  event.preventDefault();

  if (!selectedVehicle) {
    return notify("Seleciona primeiro um veículo.", "error");
  }

  const record = {
    vehicle_id: selectedVehicle.id,
    service_date: $("serviceDate").value,
    odometer_km: Number($("odometerKm").value),
    category: $("category").value.trim() || null,
    title: $("maintenanceTitle").value.trim(),
    cost_eur: $("costEur").value ? Number($("costEur").value) : null,
    next_service_km: $("nextServiceKm").value ? Number($("nextServiceKm").value) : null,
    next_service_date: $("nextServiceDate").value || null,
    parts_public: $("partsPublic").value.trim() || null,
    notes_private: $("notesPrivate").value.trim() || null,
    owner_id: currentUser.id
  };

  const id = $("maintenanceId").value;
  const query = id
    ? db.from("maintenance_records").update(record).eq("id", id)
    : db.from("maintenance_records").insert(record);

  const { error } = await query;

  if (error) {
    notify("Não foi possível guardar a intervenção: " + error.message, "error");
    return;
  }

  // Atualiza a quilometragem do veículo se a intervenção for mais recente.
  if (record.odometer_km > Number(selectedVehicle.current_km || 0)) {
    const { error: kmError } = await db
      .from("vehicles")
      .update({ current_km: record.odometer_km })
      .eq("id", selectedVehicle.id);

    if (kmError) {
      notify("Intervenção guardada, mas não foi possível atualizar os quilómetros.", "error");
    }
  }

  $("maintenanceForm").reset();
  $("maintenanceId").value = "";
  $("maintenanceForm").classList.add("hidden");

  notify("Intervenção guardada.", "success");
  await loadVehicles();
  if (selectedVehicle) await loadMaintenance(selectedVehicle);
}

/* ---------- Alertas ---------- */

function renderAlerts() {
  const today = new Date().toISOString().slice(0, 10);
  const alerts = [];

  vehicles.forEach(v => {
    if (v.ipo_due_date) {
      const days = Math.ceil(
        (new Date(v.ipo_due_date + "T00:00:00") -
         new Date(today + "T00:00:00")) / 86400000
      );

      if (days <= 30) {
        alerts.push({
          title: `${v.make} ${v.model} — IPO`,
          message: days < 0
            ? `IPO expirada há ${Math.abs(days)} dias.`
            : days === 0
              ? "IPO termina hoje."
              : `IPO dentro de ${days} dias.`
        });
      }
    }
  });

  $("alertCount") && ($("alertCount").textContent = alerts.length);

  const panel = $("alertsPanel");
  const list = $("alertsList");

  if (!panel || !list) return;

  panel.classList.toggle("hidden", alerts.length === 0);

  list.innerHTML = alerts.map(a => `
    <div class="alert alert-warning">
      <strong>${escapeHTML(a.title)}</strong>
      <p>${escapeHTML(a.message)}</p>
    </div>
  `).join("");
}

/* ---------- Ficha QR ---------- */

function openQr(vehicle) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("vehicle", vehicle.code || vehicle.id);

  $("qrVehicleTitle").textContent = `${vehicle.make} ${vehicle.model}`;
  $("qrUrl").value = url.href;
  $("qrHelp").textContent =
    "A ficha pública só ficará disponível quando a função SQL pública for ligada e testada.";

  $("qrImage").src =
    "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" +
    encodeURIComponent(url.href);

  $("qrDialog")?.showModal();
}

async function showPublicVehicle(code) {
  $("loginPanel")?.classList.add("hidden");
  $("appView")?.classList.add("hidden");
  $("publicView")?.classList.remove("hidden");

  $("publicVehicle").innerHTML =
    "<p>A ficha pública ainda precisa de ser ligada à função SQL get_public_vehicle. " +
    "Não serão apresentados dados privados através deste endereço.</p>";

  $("publicMaintenance").innerHTML = "";
  console.info("Pedido de ficha pública:", code);
}

/* ---------- API interna ---------- */

window.GaragemOnline = {
  get client() { return db; },
  get user() { return currentUser; },
  get profile() { return currentProfile; },
  get vehicles() { return vehicles; },
  get selectedVehicle() { return selectedVehicle; },
  reload: loadVehicles,
  logout: () => db?.auth.signOut()
};
