// ============================================
// GARAGEM ONLINE — ANJOSENERGY
// app.js
// ============================================

const SUPABASE_URL = "https://bsnbjpenrsubqoatqqne.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Pn01p8lXk3oomJ2urIU-qA_E7dEvuFR";

let supabaseClient = null;
let currentUser = null;
let currentProfile = null;

// Inicialização
document.addEventListener("DOMContentLoaded", async () => {
if (!window.supabase || !window.supabase.createClient) {
console.error("A biblioteca Supabase não foi carregada.");
showMessage("Erro: não foi possível carregar o Supabase.", "error");
return;
}

supabaseClient = window.supabase.createClient(
SUPABASE_URL,
SUPABASE_ANON_KEY
);

await restoreSession();

supabaseClient.auth.onAuthStateChange((_event, session) => {
setTimeout(async () => {
if (session?.user) {
currentUser = session.user;
await loadProfile();
} else {
currentUser = null;
currentProfile = null;
showLogin();
}
}, 0);
});

bindLoginForm();
bindLogoutButtons();
});

// Recuperar sessão
async function restoreSession() {
const { data, error } = await supabaseClient.auth.getSession();

if (error) {
console.error("Erro ao recuperar sessão:", error.message);
showLogin();
return;
}

if (data.session?.user) {
currentUser = data.session.user;
await loadProfile();
} else {
showLogin();
}
}

// Login por email e palavra-passe
async function login(email, password) {
if (!supabaseClient) {
showMessage("A ligação ao servidor ainda não está pronta.", "error");
return;
}

const { data, error } = await supabaseClient.auth.signInWithPassword({
email: email.trim(),
password
});

if (error) {
showMessage("Não foi possível iniciar sessão. Confirma o email e a palavra-passe.", "error");
console.error("Erro de autenticação:", error.message);
return;
}

currentUser = data.user;
await loadProfile();
}

// Carregar perfil e função do utilizador
async function loadProfile() {
if (!currentUser) return;

const { data, error } = await supabaseClient
.from("profiles")
.select("id, email, full_name, role")
.eq("id", currentUser.id)
.maybeSingle();

if (error) {
console.error("Erro ao carregar perfil:", error.message);
showMessage("Não foi possível carregar o perfil do utilizador.", "error");
return;
}

if (!data) {
showMessage("A conta não tem perfil associado. Contacta o administrador.", "error");
return;
}

currentProfile = data;

// Evento para outras partes da aplicação
document.dispatchEvent(new CustomEvent("garage:ready", {
detail: {
user: currentUser,
profile: currentProfile
}
}));

console.log("Sessão iniciada:", currentProfile.email, currentProfile.role);
}

// Terminar sessão
async function logout() {
if (!supabaseClient) return;

const { error } = await supabaseClient.auth.signOut();

if (error) {
showMessage("Não foi possível terminar a sessão.", "error");
console.error(error.message);
return;
}

currentUser = null;
currentProfile = null;
showLogin();
}

// Ligar formulário de login
function bindLoginForm() {
const form =
document.getElementById("loginForm") ||
document.getElementById("authForm");

if (!form) return;

form.addEventListener("submit", async (event) => {
event.preventDefault();

const emailInput =
  form.querySelector('[name="email"]') ||
  document.getElementById("email");

const passwordInput =
  form.querySelector('[name="password"]') ||
  document.getElementById("password");

if (!emailInput || !passwordInput) {
  showMessage("Não encontrei os campos de email e palavra-passe.", "error");
  return;
}

const submitButton = form.querySelector('[type="submit"]');

if (submitButton) {
  submitButton.disabled = true;
  submitButton.textContent = "A entrar...";
}

try {
  await login(emailInput.value, passwordInput.value);
} finally {
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.textContent = "Entrar";
  }
}

});
}

// Ligar botões de saída
function bindLogoutButtons() {
document.querySelectorAll(
"#logoutBtn, #logoutButton, [data-action='logout']"
).forEach((button) => {
button.addEventListener("click", logout);
});
}

// Mostrar ecrã de login, se existir
function showLogin() {
const loginView = document.getElementById("loginView");
const loginContainer = document.getElementById("loginContainer");
const appView = document.getElementById("appView");
const appContainer = document.getElementById("appContainer");

if (loginView) loginView.hidden = false;
if (loginContainer) loginContainer.hidden = false;
if (appView) appView.hidden = true;
if (appContainer) appContainer.hidden = true;
}

// Mostrar mensagens na interface
function showMessage(message, type = "info") {
const target =
document.getElementById("message") ||
document.getElementById("messages") ||
document.getElementById("alert");

if (target) {
target.textContent = message;
target.className = "alert ${type === "error" ? "alert-error" : type === "success" ? "alert-success" : ""}";
target.hidden = false;
} else {
console.log("[${type}] ${message}");
}
}

// Funções disponíveis para o resto da aplicação
window.GaragemOnline = {
get client() {
return supabaseClient;
},
get user() {
return currentUser;
},
get profile() {
return currentProfile;
},
login,
logout,
showMessage
};
