
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

// Mantém o formulário de palavra-passe durante o convite.
let passwordSetupPending = false;
let authInitialized = false;

const $ = (id) => document.getElementById(id);

function notify(message, type = "info", targetId = "status") {
  const target = $(targetId) || $("status") || $("loginStatus");

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

function setVisible(id, visible) {
  $(id)?.classList.toggle("hidden", !visible);
}

/* ---------- Convite e recuperação ---------- */

function detectPasswordSetup() {
  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(
    location.hash.replace(/^#/, "")
  );

  const type = hashParams.get("type");

  return (
    hashParams.has("access_token") &&
    ["invite", "recovery", "signup", "magiclink"].includes(type)
  ) || params.has("code");
}

function showPasswordSetup(message = "") {
  passwordSetupPending = true;

  setVisible("loginPanel", false);
  setVisible("appView", false);
  setVisible("publicView", false);
  setVisible("passwordPanel", true);

  if (message) {
    notify(message, "info", "passwordStatus");
  }

  $("passwordPanel")?.scrollIntoView({ behavior: "smooth" });
}

function clearAuthUrl() {
  const url = new URL(location.href);

  url.hash = "";
  url.searchParams.delete("code");
  url.searchParams.delete("type");
  url.searchParams.delete("token");
  url.searchParams.delete("token_hash");

  history.replaceState({}, document.title, url.pathname + url.search);
}

/* ---------- Interface ---------- */

function showLoggedOut() {
  setVisible("loginPanel", true);
  setVisible("appView", false);
  setVisible("publicView", false);

  if (passwordSetupPending) {
    showPasswordSetup();
    return;
  }

  setVisible("passwordPanel", false);

  if ($("userBadge")) $("userBadge").textContent = "";
  if ($("authToggle")) $("authToggle").textContent = "Entrar";
}

function showLoggedIn() {
  // Nunca esconder o formulário enquanto o convite
  // ou a recuperação da palavra-passe estiver pendente.
  if (passwordSetupPending) {
    showPasswordSetup();
    return;
  }

  setVisible("loginPanel", false);
  setVisible("passwordPanel", false);
  setVisible("appView", true);
  setVisible("publicView", false);

  if ($("userBadge")) {
    $("userBadge").textContent =
      currentProfile?.full_name || currentUser?.email || "";
  }

  if ($("authToggle")) $("authToggle").textContent = "Sair";

  if ($("roleLabel")) {
    $("roleLabel").textContent = isMaster() ? "Master" : "Mecânico";
  }

  document.querySelectorAll(".masterOnly").forEach((element) => {
    element.classList.toggle("hidden", !isMaster());
  });

  setVisible("teamPanel", isMaster());
}

/* ---------- Inicialização ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  if (!window.supabase?.createClient) {
    notify(
      "Não foi possível carregar a biblioteca Supabase.",
      "error",
      "loginStatus"
    );
    return;
  }

  passwordSetupPending = detectPasswordSetup();

  db = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  bindEvents();

  if (passwordSetupPending) {
    showPasswordSetup(
      "Define uma palavra-passe com pelo menos 8 caracteres."
    );
  }

  // Se o convite utilizar PKCE, trocar o código por uma sessão.
  const params = new URLSearchParams(location.search);
  const code = params.get("code");

  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Erro ao validar convite:", error);
      showPasswordSetup(
        "Não foi possível validar o convite. Abre novamente o link mais recente do email."
      );
      notify(
        "Erro ao validar o convite: " + error.message,
        "error",
        "passwordStatus"
      );
    } else {
      showPasswordSetup(
        "Convite validado. Agora define a tua palavra-passe."
      );
    }
  }

  const { data, error } = await db.auth.getSession();

  if (error) {
    notify("Erro ao recuperar sessão: " + error.message, "error");
    return;
  }

  if (data.session?.user) {
    if (passwordSetupPending) {
      showPasswordSetup(
        "Define uma palavra-passe com pelo menos 8 caracteres."
      );
    } else {
      await loadProfile(data.session.user);
    }
  } else if (!passwordSetupPending) {
    showLoggedOut();
  }

  db.auth.onAuthStateChange((event, session) => {
    // Não deixar os eventos de autenticação esconderem
    // o formulário de definição de palavra-passe.
    if (passwordSetupPending) {
      showPasswordSetup();
      return;
    }

    if (
      event === "PASSWORD_RECOVERY" ||
      event === "SIGNED_IN" &&
      detectPasswordSetup()
    ) {
      showPasswordSetup(
        "Define uma palavra-passe com pelo menos 8 caracteres."
      );
      return;
    }

    if (session?.user) {
      setTimeout(() => {
        if (!passwordSetupPending) {
          loadProfile(session.user);
        }
      }, 0);
    } else {
      currentUser = null;
      currentProfile = null;
      vehicles = [];
      selectedVehicle = null;
      maintenanceRecords = [];
      showLoggedOut();
    }
  });

  authInitialized = true;

  if (params.get("vehicle") && !passwordSetupPending) {
    await showPublicVehicle(params.get("vehicle"));
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

      if (error) throw error;
    } catch (error) {
      notify(
        "Falha no login: " + error.message,
        "error",
        "loginStatus"
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Entrar";
      }
    }
  });

  $("authToggle")?.addEventListener("click", async () => {
    if (passwordSetupPending) {
      showPasswordSetup();
      return;
    }

    if (!currentUser) {
      $("loginPanel")?.scrollIntoView({ behavior: "smooth" });
      $("email")?.focus();
      return;
    }

    const { error } = await db.auth.signOut();

    if (error) {
      notify("Não foi possível terminar a sessão.", "error");
    }
  });

  $("passwordForm")?.addEventListener("submit", saveNewPassword);

  $("newVehicleBtn")?.addEventListener("click", () => {
    if (!isMaster()) {
      notify("Apenas o Master pode criar veículos.", "error");
      return;
    }

    resetVehicleForm();
    setVisible("vehicleForm", true);
    $("vehicleForm")?.scrollIntoView({ behavior: "smooth" });
  });

  $("cancelVehicle")?.addEventListener("click", resetVehicleForm);
  $("vehicleForm")?.addEventListener("submit", saveVehicle);

  $("addMaintenanceBtn")?.addEventListener("click", () => {
    if (!selectedVehicle) {
      notify("Seleciona primeiro um veículo.");
      return;
    }

    setVisible("maintenanceForm", true);
    $("maintenanceForm")?.scrollIntoView({ behavior: "smooth" });
  });

  $("cancelMaintenance")?.addEventListener("click", () => {
    $("maintenanceForm")?.reset();
    if ($("maintenanceId")) $("maintenanceId").value = "";
    setVisible("maintenanceForm", false);
  });

  $("maintenanceForm")?.addEventListener("submit", saveMaintenance);

  // NOVO: exportação Excel, apenas para a conta Master.
  $("exportExcelBtn")?.addEventListener("click", exportToExcel);

  $("refreshTeam")?.addEventListener("click", loadTeam);

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

  bindCreateTeamForm();
}

/* ---------- Palavra-passe / convite ---------- */

async function saveNewPassword(event) {
  event.preventDefault();

  const password = $("newPassword")?.value || "";
  const confirmation = $("confirmPassword")?.value || "";
  const button = $("savePasswordButton");

  if (password.length < 8) {
    notify(
      "A palavra-passe deve ter pelo menos 8 caracteres.",
      "error",
      "passwordStatus"
    );
    return;
  }

  if (password !== confirmation) {
    notify(
      "As palavras-passe não coincidem.",
      "error",
      "passwordStatus"
    );
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "A guardar...";
  }

  try {
    const { data: sessionData, error: sessionError } =
      await db.auth.getSession();

    if (sessionError) throw sessionError;

    if (!sessionData.session) {
      throw new Error(
        "Não existe uma sessão válida para este convite. " +
        "Abre novamente o link mais recente do email."
      );
    }

    const { error } = await db.auth.updateUser({ password });

    if (error) throw error;

    passwordSetupPending = false;
    clearAuthUrl();

    $("passwordForm")?.reset();

    notify(
      "Palavra-passe definida com sucesso.",
      "success",
      "passwordStatus"
    );

    const { data: userData, error: userError } =
      await db.auth.getUser();

    if (userError) throw userError;

    if (userData.user) {
      await loadProfile(userData.user);
    } else {
      setVisible("passwordPanel", false);
      showLoggedOut();
    }
  } catch (error) {
    console.error("Erro ao definir palavra-passe:", error);

    notify(
      "Não foi possível definir a palavra-passe: " + error.message,
      "error",
      "passwordStatus"
    );

    showPasswordSetup();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Guardar palavra-passe";
    }
  }
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

    if (passwordSetupPending) {
      showPasswordSetup();
      return;
    }

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

  if (passwordSetupPending) return;

  await loadVehicles();

  if (isMaster()) await loadTeam();
}

/* ---------- Gestão da equipa ---------- */

function bindCreateTeamForm() {
  const form = $("createTeamForm");
  if (!form || form.dataset.bound === "true") return;

  form.dataset.bound = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser || !isMaster()) {
      notify("Só o Master pode criar funcionários.", "error");
      return;
    }

    const name = $("teamName")?.value.trim();
    const email = $("teamEmail")?.value.trim();
    const button = $("createTeamButton");

    if (!name || !email) {
      notify("Preenche o nome e o email.", "error");
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "A criar conta...";
    }

    try {
      const { data, error } = await db.functions.invoke(
        "create-team-user",
        {
          body: {
            nome: name,
            email,
            role: "mechanic"
          }
        }
      );

      if (error) {
        let message = error.message;

        try {
          const details = await error.context?.json();
          if (details?.error) message = details.error;
        } catch {}

        throw new Error(message);
      }

      if (!data?.success) {
        throw new Error(data?.error || "Não foi possível criar a conta.");
      }

      notify(
        data.message || "Convite enviado por email.",
        "success"
      );

      form.reset();
      await loadTeam();
    } catch (error) {
      console.error("Erro ao criar funcionário:", error);
      notify("Erro ao criar funcionário: " + error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Criar conta e enviar convite";
      }
    }
  });
}

async function loadTeam() {
  if (!db || !currentUser || !isMaster()) return;

  const list = $("teamList");
  const refresh = $("refreshTeam");

  if (!list) return;

  if (refresh) refresh.disabled = true;
  list.textContent = "A carregar equipa...";

  try {
    const { data, error } = await db.rpc("master_list_profiles");
    if (error) throw error;

    if (!data?.length) {
      list.textContent = "Não existem perfis para apresentar.";
      return;
    }

    list.innerHTML = data.map((member) => {
      const role = member.role === "master" ? "master" : "mechanic";
      const ownAccount = member.id === currentUser.id;

      return `
        <article class="panel team-card">
          <h3>${escapeHTML(member.full_name || "Sem nome")}</h3>
          <p>${escapeHTML(member.email || "Email não indicado")}</p>
          <p>Função:
            <strong>${role === "master" ? "Master" : "Mecânico"}</strong>
          </p>

          <label>Nova função
            <select data-team-role="${escapeHTML(member.id)}"
              ${ownAccount ? "disabled" : ""}>
              <option value="master" ${role === "master" ? "selected" : ""}>
                Master
              </option>
              <option value="mechanic" ${role === "mechanic" ? "selected" : ""}>
                Mecânico
              </option>
            </select>
          </label>

          <div class="actions">
            <button type="button"
              data-team-save="${escapeHTML(member.id)}"
              ${ownAccount ? "disabled" : ""}>
              Guardar função
            </button>

            <button type="button"
              class="secondary"
              data-team-delete="${escapeHTML(member.id)}"
              ${ownAccount ? "disabled" : ""}>
              Apagar funcionário
            </button>
          </div>

          ${ownAccount
            ? '<p class="muted small">Esta é a tua própria conta.</p>'
            : ""}
        </article>
      `;
    }).join("");

    list.querySelectorAll("[data-team-save]").forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.dataset.teamSave;
        const select = list.querySelector(`[data-team-role="${userId}"]`);
        const newRole = select?.value;

        if (!isMaster() || userId === currentUser.id) return;

        if (!["master", "mechanic"].includes(newRole)) {
          notify("Função inválida.", "error");
          return;
        }

        button.disabled = true;

        try {
          const { error } = await db.rpc("master_set_profile_role", {
            p_user_id: userId,
            p_role: newRole
          });

          if (error) throw error;

          notify("Função atualizada.", "success");
          await loadTeam();
        } catch (error) {
          notify("Erro ao alterar função: " + error.message, "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    list.querySelectorAll("[data-team-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.dataset.teamDelete;
        if (!isMaster() || userId === currentUser.id) return;

        if (!confirm(
          "Tens a certeza de que queres apagar este funcionário? " +
          "Esta operação não pode ser desfeita."
        )) return;

        button.disabled = true;

        try {
          const { data, error } = await db.functions.invoke(
            "delete-team-user",
            { body: { user_id: userId } }
          );

          if (error) throw error;

          if (!data?.success) {
            throw new Error(data?.error || "Não foi possível apagar a conta.");
          }

          notify("Funcionário apagado.", "success");
          await loadTeam();
        } catch (error) {
          notify(
            "A eliminação não está disponível ou falhou: " + error.message,
            "error"
          );
        } finally {
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    console.error("Erro ao carregar equipa:", error);
    list.textContent = "Erro ao carregar equipa: " + error.message;
    notify("Não foi possível carregar a equipa.", "error");
  } finally {
    if (refresh) refresh.disabled = false;
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
    const updated = vehicles.find((v) => v.id === selectedVehicle.id);

    if (updated) {
      selectedVehicle = updated;
      await loadMaintenance(updated);
    } else {
      selectedVehicle = null;
      setVisible("maintenancePanel", false);
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

  list.innerHTML = vehicles.map((vehicle) => `
    <article class="panel vehicle-card">
      <p class="eyebrow">${escapeHTML(vehicle.code || "FROTA")}</p>
      <h3>${escapeHTML(vehicle.make)} ${escapeHTML(vehicle.model)}</h3>
      <p>Matrícula:
        <strong>${escapeHTML(vehicle.plate || "—")}</strong>
      </p>
      <p>Quilometragem: ${escapeHTML(vehicle.current_km ?? 0)} km</p>
      <p>IPO: ${escapeHTML(vehicle.ipo_due_date || "Não indicada")}</p>

      <div class="actions">
        <button data-action="select" data-id="${escapeHTML(vehicle.id)}">
          Manutenção
        </button>

        ${isMaster() ? `
          <button class="secondary"
            data-action="edit" data-id="${escapeHTML(vehicle.id)}">
            Editar
          </button>
          <button class="secondary"
            data-action="qr" data-id="${escapeHTML(vehicle.id)}">
            Ficha / QR
          </button>
          <button class="secondary"
            data-action="delete" data-id="${escapeHTML(vehicle.id)}">
            Apagar veículo
          </button>
        ` : ""}
      </div>
    </article>
  `).join("");

  list.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const vehicle = vehicles.find(
        (v) => String(v.id) === button.dataset.id
      );

      if (!vehicle) return;

      if (button.dataset.action === "select") {
        selectedVehicle = vehicle;
        setVisible("maintenancePanel", true);
        $("maintenanceHeading").textContent =
          `Manutenção — ${vehicle.make} ${vehicle.model}`;
        setVisible("maintenanceForm", false);
        await loadMaintenance(vehicle);
      }

      if (button.dataset.action === "edit" && isMaster()) {
        fillVehicleForm(vehicle);
      }

      if (button.dataset.action === "qr" && isMaster()) {
        openQr(vehicle);
      }

      if (button.dataset.action === "delete" && isMaster()) {
        await deleteVehicle(vehicle);
      }
    });
  });
}

async function deleteVehicle(vehicle) {
  if (!isMaster()) {
    notify("Só o Master pode apagar veículos.", "error");
    return;
  }

  const description = `${vehicle.make} ${vehicle.model}`;

  if (!confirm(
    `Apagar ${description} e todo o histórico de manutenção associado? ` +
    "Esta operação não pode ser desfeita."
  )) return;

  try {
    const { data, error } = await db.functions.invoke(
      "delete-vehicle",
      { body: { vehicle_id: vehicle.id } }
    );

    if (error) throw error;

    if (!data?.success) {
      throw new Error(data?.error || "Não foi possível apagar o veículo.");
    }

    if (selectedVehicle?.id === vehicle.id) {
      selectedVehicle = null;
      maintenanceRecords = [];
      setVisible("maintenancePanel", false);
    }

    notify("Veículo apagado.", "success");
    await loadVehicles();
  } catch (error) {
    notify(
      "A eliminação não está disponível ou falhou: " + error.message,
      "error"
    );
  }
}

function fillVehicleForm(vehicle) {
  $("vehicleId").value = vehicle.id || "";
  $("make").value = vehicle.make || "";
  $("model").value = vehicle.model || "";
  $("plate").value = vehicle.plate || "";
  $("year").value = vehicle.year || "";
  $("engine").value = vehicle.engine || "";
  $("fuel").value = vehicle.fuel || "";
  $("currentKm").value = vehicle.current_km ?? "";
  $("ipoDueDate").value = vehicle.ipo_due_date || "";
  $("code").value = vehicle.code || "";
  $("publicDescription").value = vehicle.public_description || "";
  $("privateNotes").value = vehicle.private_notes || "";

  $("vehicleFormTitle").textContent = "Editar veículo";
  setVisible("vehicleForm", true);
  $("vehicleForm")?.scrollIntoView({ behavior: "smooth" });
}

function resetVehicleForm() {
  $("vehicleForm")?.reset();
  if ($("vehicleId")) $("vehicleId").value = "";
  if ($("vehicleFormTitle")) {
    $("vehicleFormTitle").textContent = "Novo veículo";
  }
  setVisible("vehicleForm", false);
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

  list.innerHTML = maintenanceRecords.map((record) => `
    <article class="panel maintenance-card">
      <h3>${escapeHTML(record.title)}</h3>
      <p>Data: ${escapeHTML(record.service_date || "—")} ·
        ${escapeHTML(record.odometer_km ?? "—")} km</p>
      <p>Categoria: ${escapeHTML(record.category || "—")}</p>
      <p>Custo: ${
        record.cost_eur == null
          ? "—"
          : escapeHTML(Number(record.cost_eur).toFixed(2) + " €")
      }</p>
      <p>${escapeHTML(record.parts_public || "")}</p>
      ${isMaster()
        ? `<p>Notas internas:
            ${escapeHTML(record.notes_private || "—")}
           </p>`
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
    notes_private: $("maintenanceNotesPrivate")?.value.trim() || null,
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
  setVisible("maintenanceForm", false);

  notify("Intervenção guardada.", "success");
  await loadVehicles();

  if (selectedVehicle) await loadMaintenance(selectedVehicle);
}

/* ---------- Exportação Excel ---------- */

async function exportToExcel() {
  if (!currentUser || !isMaster()) {
    notify("Só a conta Master pode exportar os dados.", "error");
    return;
  }

  if (!window.XLSX) {
    notify(
      "Não foi possível carregar a biblioteca Excel. Verifica a ligação à internet.",
      "error"
    );
    return;
  }

  const button = $("exportExcelBtn");

  if (button) {
    button.disabled = true;
    button.textContent = "A preparar Excel...";
  }

  try {
    // Consultar as viaturas acessíveis à conta atual.
    const { data: vehicleData, error: vehicleError } = await db
      .from("vehicles")
      .select("*")
      .order("make", { ascending: true });

    if (vehicleError) throw vehicleError;

    // Consultar as manutenções acessíveis à conta atual.
    const { data: maintenanceData, error: maintenanceError } = await db
      .from("maintenance_records")
      .select("*")
      .order("service_date", { ascending: false });

    if (maintenanceError) throw maintenanceError;

    const allVehicles = vehicleData || [];
    const allMaintenance = maintenanceData || [];

    const vehicleRows = allVehicles.map((v) => ({
      "Código interno": v.code || "",
      "Matrícula": v.plate || "",
      "Marca": v.make || "",
      "Modelo": v.model || "",
      "Ano": v.year ?? "",
      "Motor": v.engine || "",
      "Combustível": v.fuel || "",
      "Quilómetros atuais": v.current_km ?? "",
      "Data limite IPO": v.ipo_due_date || "",
      "Descrição pública": v.public_description || "",
      "Notas internas": v.private_notes || ""
    }));

    const vehicleById = new Map(
      allVehicles.map((v) => [v.id, v])
    );

    const maintenanceRows = allMaintenance.map((m) => {
      const vehicle = vehicleById.get(m.vehicle_id);

      return {
        "Matrícula": vehicle?.plate || "",
        "Marca": vehicle?.make || "",
        "Modelo": vehicle?.model || "",
        "Data": m.service_date || "",
        "Quilómetros": m.odometer_km ?? "",
        "Categoria": m.category || "",
        "Serviço efetuado": m.title || "",
        "Peças / trabalho": m.parts_public || "",
        "Notas internas": m.notes_private || "",
        "Custo (€)": m.cost_eur == null ? "" : Number(m.cost_eur),
        "Próxima manutenção (km)": m.next_service_km ?? "",
        "Data da próxima manutenção": m.next_service_date || ""
      };
    });

    const workbook = XLSX.utils.book_new();

    const vehicleSheet = XLSX.utils.json_to_sheet(vehicleRows);
    const maintenanceSheet = XLSX.utils.json_to_sheet(maintenanceRows);

    vehicleSheet["!cols"] = [
      { wch: 16 },
      { wch: 14 },
      { wch: 18 },
      { wch: 22 },
      { wch: 10 },
      { wch: 18 },
      { wch: 16 },
      { wch: 20 },
      { wch: 18 },
      { wch: 32 },
      { wch: 32 }
    ];

    maintenanceSheet["!cols"] = [
      { wch: 14 },
      { wch: 18 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 30 },
      { wch: 32 },
      { wch: 32 },
      { wch: 14 },
      { wch: 24 },
      { wch: 24 }
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      vehicleSheet,
      "Viaturas"
    );

    XLSX.utils.book_append_sheet(
      workbook,
      maintenanceSheet,
      "Manutenções"
    );

    const date = new Date().toISOString().slice(0, 10);

    XLSX.writeFile(
      workbook,
      `AnjosEnergy_Exportacao_${date}.xlsx`
    );

    notify(
      `Exportação concluída: ${allVehicles.length} viaturas e ${allMaintenance.length} manutenções.`,
      "success"
    );
  } catch (error) {
    console.error("Erro na exportação Excel:", error);

    notify(
      "Erro ao exportar Excel: " + error.message,
      "error"
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Exportar para Excel";
    }
  }
}

/* ---------- Alertas de IPO ---------- */

function renderAlerts() {
  const today = new Date().toISOString().slice(0, 10);
  const alerts = [];

  vehicles.forEach((vehicle) => {
    if (!vehicle.ipo_due_date) return;

    const days = Math.ceil(
      (
        new Date(vehicle.ipo_due_date + "T00:00:00") -
        new Date(today + "T00:00:00")
      ) / 86400000
    );

    if (days <= 30) {
      alerts.push({
        title: `${vehicle.make} ${vehicle.model} — IPO`,
        message: days < 0
          ? `IPO expirada há ${Math.abs(days)} dias.`
          : days === 0
            ? "IPO termina hoje."
            : `IPO dentro de ${days} dias.`
      });
    }
  });

  if ($("alertCount")) {
    $("alertCount").textContent = alerts.length;
  }

  const panel = $("alertsPanel");
  const list = $("alertsList");

  if (!panel || !list) return;

  panel.classList.toggle("hidden", alerts.length === 0);

  list.innerHTML = alerts.map((alert) => `
    <div class="alert alert-warning">
      <strong>${escapeHTML(alert.title)}</strong>
      <p>${escapeHTML(alert.message)}</p>
    </div>
  `).join("");
}

/* ---------- QR e área pública ---------- */

function openQr(vehicle) {
  const url = new URL(location.href);

  url.search = "";
  url.searchParams.set("vehicle", vehicle.public_id || vehicle.id);

  $("qrVehicleTitle").textContent = `${vehicle.make} ${vehicle.model}`;
  $("qrUrl").value = url.href;
  $("qrHelp").textContent =
    "A ficha pública ainda necessita de ligação à função SQL pública.";

  $("qrImage").src =
    "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" +
    encodeURIComponent(url.href);

  $("qrDialog")?.showModal();
}

async function showPublicVehicle(code) {
  setVisible("loginPanel", false);
  setVisible("appView", false);
  setVisible("publicView", true);

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
};
