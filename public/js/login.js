const form = document.getElementById('loginForm');
const btn = document.getElementById('btnSubmit');
const emailInput = document.getElementById('email');
const rememberCheck = document.getElementById('rememberMe');

// 1. AL CARGAR LA PÁGINA: VERIFICAR SI HAY CORREO GUARDADO
window.addEventListener('DOMContentLoaded', () => {
    // Verificar si ya hay sesión activa (Opcional, si quieres auto-login)
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (session) {
        // window.location.href = '/dashboard.html'; 
    }

    const savedEmail = localStorage.getItem('saved_email');
    if (savedEmail) {
        emailInput.value = savedEmail;
        rememberCheck.checked = true;
    }
});

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    const email = emailInput.value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (data.ok) {
            // --- LÓGICA DE RECORDARME ---
            if (rememberCheck.checked) {
                localStorage.setItem('saved_email', email);
            } else {
                localStorage.removeItem('saved_email');
            }

            // Guardar sesión
            localStorage.setItem('user_session', JSON.stringify(data.user));
            localStorage.setItem('auth_token', data.token);
            
            Toast.fire({ icon: 'success', title: `¡Hola, ${data.user.nombre}!` });
            
            // Redirigir
            setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);

        } else {
            Swal.fire({
                icon: 'error',
                title: 'Acceso Denegado',
                text: data.msg || 'Usuario o contraseña incorrectos.',
                confirmButtonColor: '#2563eb'
            });
            btn.disabled = false;
            btn.innerHTML = originalText;
        }

    } catch (err) {
        console.error(err);
        Swal.fire({
            icon: 'error',
            title: 'Error de Conexión',
            text: 'No se pudo conectar con el servidor.',
            confirmButtonColor: '#ef4444'
        });
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const passwordInput = document.getElementById('password');
    const keypad = document.getElementById('virtual-keypad');
    const keyBtns = document.querySelectorAll('.key-btn[data-val]');
    const btnDel = document.getElementById('keypad-del');
    const btnClear = document.getElementById('keypad-clear');
    const toggleKeypad = document.getElementById('toggleKeypad');
    const togglePassword = document.getElementById('togglePassword');

    // 1. Alternar teclado virtual con el botón de calculadora/teclado
    if (toggleKeypad && keypad) {
        toggleKeypad.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            keypad.classList.toggle('active');
            if (keypad.classList.contains('active')) {
                setTimeout(() => {
                    keypad.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }, 150);
            }
        });
    }

    // 2. Lógica para cada botón del teclado en pantalla
    keyBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            passwordInput.value += btn.getAttribute('data-val');
            passwordInput.focus();
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    // 3. Botón para borrar el último número
    if (btnDel) {
        btnDel.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            passwordInput.value = passwordInput.value.slice(0, -1);
            passwordInput.focus();
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    // 4. Botón para borrar toda la contraseña (Basurero)
    if (btnClear) {
        btnClear.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            passwordInput.value = '';
            passwordInput.focus();
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            if (keypad) keypad.classList.remove('active');
        });
    }

    // 5. Ocultar teclado en pantalla al hacer clic fuera de él
    document.addEventListener('click', (e) => {
        if (!keypad) return;
        if (!keypad.contains(e.target) && e.target !== toggleKeypad && !toggleKeypad?.contains(e.target)) {
            keypad.classList.remove('active');
        }
    });

    // 6. Alternar ver/ocultar contraseña (Ojito)
    if (togglePassword) {
        togglePassword.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }
});

