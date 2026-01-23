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