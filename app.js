
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

const $ = (id) => document.getElementById(id);

/* ---------- Mensagens e utilitários ---------- */

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

/* ---------- Interface ---------- */

function showLoggedOut() {
  $("loginPanel")?.classList.remove("hidden");
  $("appView")?.classList.add("hidden");
  $("publicView")?.classList.add("hidden");

  if ($("userBadge")) $("userBadge").textContent = "";
  if ($("authToggle")) $("authToggle").textContent = "Entrar";
}

function showLoggedIn() {
  $("loginPanel")?.classList.add("hidden");
  $("appView")?.classList.remove("hidden");
  $("publicView")?.classList.add("hidden");

  if ($("userBadge")) {
    $("userBadge").textContent =
      currentProfile?.full_name ||
      currentUser?.email ||
      "";
  }

  if ($("authToggle")) $("authToggle").textContent = "Sair";

  if ($("roleLabel")) {
    $("roleLabel").textContent = isMaster() ? "Master" : "Mecânico";
  }

  document.querySelectorAll(".masterOnly").forEach((element) => {
    element.classList.toggle("hidden", !isMaster());
  });

  $("teamPanel")?.classList.toggle("hidden", !isMaster());
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
    notify("Erro ao recuperar sessão: " + error.message, "error");
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
        maintenanceRecords = [];
        showLoggedOut();
      }
    }, 0);
  });

  const params = new URLSearchParams(location.search);
  const publicCode = params.get("vehicle");

  if (publicCode) {
    await showPublicVehicle(publicCode);
  }
});

/* ---------- Eventos ---------- */

function bindEvents() {
  $("loginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("loginForm").querySelector('[type="submit"]');

    if (button) {
      button.disabled = true;
      button.textContent = "A entrar...";
    }

    try {
      const { error } = await db.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value
      });

      if (error) {
        notify("Falha no login. Confirma o email e a palavra-passe.", "error");
      }
    } catch (error) {
      notify("Erro no login: " + error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Entrar";
      }
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
    if (!isMaster()) {
      notify("Apenas o Master pode criar veículos.", "error");
      return;
    }

    resetVehicleForm();
    $("vehicleForm")?.classList.remove("hidden");
    $("vehicleForm")?.scrollIntoView({ behavior: "smooth" });
  });

  $("cancelVehicle")?.addEventListener("click", resetVehicleForm);
  $("vehicleForm")?.addEventListener("submit", saveVehicle);

  $("addMaintenanceBtn")?.addEventListener("click", () => {
    if (!selectedVehicle) {
      notify("Seleciona primeiro um veículo.");
      return;
    }

    $("maintenanceForm")?.classList.remove("hidden");
    $("maintenanceForm")?.scrollIntoView({ behavior: "smooth" });
  });

  $("cancelMaintenance")?.addEventListener("click", () => {
    $("maintenanceForm")?.reset();
    if ($("maintenanceId")) $("maintenanceId").value = "";
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

  $("refreshTeam")?.addEventListener("click", loadTeam);
}

/* ---------- Perfil ---------- */

async function loadProfile(user) {
  currentUser = user;

  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    currentProfile = null;
    showLoggedOut();

    notify(
      error
        ? "Erro ao carregar perfil: " + error.message
        : "A conta não tem perfil associado. Contacta o administrador.",
      "error"
    );

    return;
  }

  currentProfile = data;
  showLoggedIn();

  await loadVehicles();

  if (isMaster()) {
    await loadTeam();
  }
}

/* ---------- Gestão da equipa ---------- */

async function loadTeam() {
  if (!db || !currentUser || !isMaster()) return;

  const list = $("teamList");
  const button = $("refreshTeam");

  if (!list) return;

  if (button) button.disabled = true;
  list.textContent = "A carregar equipa...";

  try {
    const { data, error } = await db.rpc("master_list_profiles");

    if (error) throw error;

    if (!data || data.length === 0) {
      list.textContent = "Não existem perfis para apresentar.";
      return;
    }

    list.innerHTML = data.map(member => {
      const role = member.role === "master" ? "master" : "mechanic";
      const ownAccount = member.id === currentUser.id;

      return `
        <article class="panel team-card">
          <h3>${escapeHTML(member.full_name || "Sem nome")}</h3>
          <p>${escapeHTML(member.email || "Email não indicado")}</p>
          <p>Função atual:
            <strong>${role === "master" ? "Master" : "Mecânico"}</strong>
          </p>

          <label>
            Nova função
            <select data-team-role="${escapeHTML(member.id)}"
              ${ownAccount ? "disabled" : ""}>
              <option value="master" ${role === "master" ? "selected" : ""}>Master</option>
              <option value="mechanic" ${role === "mechanic" ? "selected" : ""}>Mecânico</option>
            </select>
          </label>

          <button type="button"
            data-team-save="${escapeHTML(member.id)}"
            ${ownAccount ? "disabled" : ""}>
            Guardar função
          </button>

          ${ownAccount
            ? '<p class="muted small">Esta é a tua própria conta.</p>'
            : ""}
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-team-save]").forEach(button => {
      button.addEventListener("click", async () => {
        const userId = button.dataset.teamSave;
        const select = list.querySelector(
          `[data-team-role="${userId}"]`
        );

        if (!isMaster() || userId === currentUser.id) return;

        const newRole = select?.value;

        if (!["master", "mechanic"].includes(newRole)) {
          notify("Função inválida.", "error");
          return;
        }

        button.disabled = true;
        button.textContent = "A guardar...";

        try {
          const { error } = await db.rpc("master_set_profile_role", {
            p_user_id: userId,
            p_role: newRole
          });

          if (error) throw error;

          notify("Função atualizada.", "success");
          await loadTeam();
        } catch (error) {
          console.error("Erro ao alterar função:", error);
          notify("Erro ao alterar função: " + error.message, "error");
        } finally {
          button.disabled = false;
          button.textContent = "Guardar função";
        }
      });
    });
  } catch (error) {
    console.error("Erro ao carregar equipa:", error);
    list.textContent = "Erro ao carregar equipa: " + error.message;
    notify("Não foi possível carregar a equipa.", "error");
  } finally {
    if (button) button.disabled = false;
  }
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
  if ($("vehicleCount")) {
    $("vehicleCount").textContent = vehicles.length;
  }

  const list = $("vehicleList");
  if (!list) return;

  if (!vehicles.length) {
    list.innerHTML =
      '<p class="muted">Ainda não existem veículos registados.</p>';
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
        <button data-action="select" data-id="${escapeHTML(v.id)}">
          Manutenção
        </button>
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

  if (!isMaster()) {
    notify("Sem permissões para alterar veículos.", "error");
    return;
  }

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

  const result = id
    ? await db.from("vehicles").update(record).eq("id", id)
    : await db.from("vehicles").insert({
        ...record,
        owner_id: currentUser.id
      });

  if (result.error) {
    notify("Erro ao guardar veículo: " + result.error.message, "error");
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
    list.innerHTML =
      '<p class="muted">Sem intervenções registadas.</p>';
    return;
  }

  list.innerHTML = maintenanceRecords.map(r => `
    <article class="panel maintenance-card">
      <h3>${escapeHTML(r.title)}</h3>
      <p>Data: ${escapeHTML(r.service_date || "—")} ·
        ${escapeHTML(r.odometer_km ?? "—")} km</p>
      <p>Categoria: ${escapeHTML(r.category || "—")}</p>
      <p>Custo: ${
        r.cost_eur == null
          ? "—"
          : escapeHTML(Number(r.cost_eur).toFixed(2) + " €")
      }</p>
      <p>${escapeHTML(r.parts_public || "")}</p>
      ${isMaster()
        ? `<p>Notas internas: ${escapeHTML(r.notes_private || "—")}</p>`
        : ""}
    </article>
  `).join("");
}

async function saveMaintenance(event) {
  event.preventDefault();

  if (!selectedVehicle) {
    notify("Seleciona primeiro um veículo.", "error");
    return;
  }

  const record = {
    vehicle_id: selectedVehicle.id,
    service_date: $("serviceDate").value,
    odometer_km: Number($("odometerKm").value),
    category: $("category").value.trim() || null,
    title: $("maintenanceTitle").value.trim(),
    cost_eur: $("costEur").value ? Number($("costEur").value) : null,
    next_service_km: $("nextServiceKm").value
      ? Number($("nextServiceKm").value)
      : null,
    next_service_date: $("nextServiceDate").value || null,
    parts_public: $("partsPublic").value.trim() || null,
    notes_private: $("notesPrivate").value.trim() || null,
    owner_id: currentUser.id
  };

  const id = $("maintenanceId").value;

  const result = id
    ? await db.from("maintenance_records").update(record).eq("id", id)
    : await db.from("maintenance_records").insert(record);

  if (result.error) {
    notify("Erro ao guardar intervenção: " + result.error.message, "error");
    return;
  }

  if (record.odometer_km > Number(selectedVehicle.current_km || 0)) {
    const { error } = await db
      .from("vehicles")
      .update({ current_km: record.odometer_km })
      .eq("id", selectedVehicle.id);

    if (error) {
      notify(
        "Intervenção guardada, mas os quilómetros não foram atualizados.",
        "error"
      );
    }
  }

  $("maintenanceForm")?.reset();
  if ($("maintenanceId")) $("maintenanceId").value = "";
  $("maintenanceForm")?.classList.add("hidden");

  notify("Intervenção guardada.", "success");
  await loadVehicles();

  if (selectedVehicle) {
    await loadMaintenance(selectedVehicle);
  }
}

/* ---------- Alertas de IPO ---------- */

function renderAlerts() {
  const today = new Date().toISOString().slice(0, 10);
  const alerts = [];

  vehicles.forEach(v => {
    if (!v.ipo_due_date) return;

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
  });

  if ($("alertCount")) $("alertCount").textContent = alerts.length;

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

/* ---------- Ficha QR e área pública ---------- */

function openQr(vehicle) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("vehicle", vehicle.public_id || vehicle.id);

  $("qrVehicleTitle").textContent = `${vehicle.make} ${vehicle.model}`;
  $("qrUrl").value = url.href;
  $("qrHelp").textContent =
    "A ficha pública só estará ativa depois de ligar e testar a função SQL pública.";

  $("qrImage").src =
    "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" +
    encodeURIComponent(url.href);

  $("qrDialog")?.showModal();
}

async function showPublicVehicle(code) {
  $("loginPanel")?.classList.add("hidden");
  $("appView")?.classList.add("hidden");
  $("publicView")?.classList.remove("hidden");

  $("publicVehicle").textContent =
    "A ficha pública ainda não está ligada à função SQL. " +
    "Por segurança, não são apresentados dados do veículo.";

  $("publicMaintenance").textContent = "";

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
   
const createTeamForm = document.getElementById("createTeamForm");

if (createTeamForm) {
  createTeamForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("teamName").value.trim();
    const email = document.getElementById("teamEmail").value.trim();
    const button = document.getElementById("createTeamButton");
    const status = document.getElementById("status");

    if (!name || !email) {
      status.textContent = "Preenche o nome e o email.";
      return;
    }

    button.disabled = true;
    button.textContent = "A criar conta...";
    status.textContent = "";

    try {
      const { data: sessionData, error: sessionError } =
        await db.auth.getSession();

      if (sessionError) throw sessionError;

      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("A sessão expirou. Entra novamente.");
      }

      const { data, error } = await db.functions.invoke(
        "create-team-user",
        {
          body: {
            nome: name,
            email: email,
            role: "mechanic"
          }
        }
      );

      if (error) {
        let details = error.message;

        try {
          const response = await error.context?.json();
          if (response?.error) details = response.error;
        } catch {}

        throw new Error(details);
      }

      if (!data?.success) {
        throw new Error(data?.error || "Não foi possível criar a conta.");
      }

      status.textContent =
        data.message || "Conta criada. Foi enviado um convite por email.";

      createTeamForm.reset();

      if (typeof loadTeam === "function") {
        await loadTeam();
      }
    } catch (error) {
      console.error("Erro ao criar funcionário:", error);
      status.textContent =
        "Erro ao criar funcionário: " + error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Criar conta e enviar convite";
    }
  });
}

};
