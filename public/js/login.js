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

document.addEventListener("DOMContentLoaded", () => {
    const passwordInput = document.getElementById('password');
    const keypad = document.getElementById('virtual-keypad');
    const keyBtns = document.querySelectorAll('.key-btn[data-val]');
    const btnDel = document.getElementById('keypad-del');
    const btnClear = document.getElementById('keypad-clear');

    // 1. Mostrar teclado al hacer click en el input
    passwordInput.addEventListener('click', (e) => {
        keypad.classList.add('active');
        e.stopPropagation(); 
        
        // Novedad: Hace un pequeño deslizamiento automático para que el teclado se vea perfecto
        setTimeout(() => {
            keypad.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 150);
    });

    // 2. Lógica para cada número (AHORA CON AUTO-CIERRE)
    keyBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); 
            
            // Si ya tiene 6 dígitos, no hacemos nada (evita ingresar de más)
            if (passwordInput.value.length >= 6) return;

            // Agregamos el número al input
            passwordInput.value += btn.getAttribute('data-val');
            
            // Si al agregar este número llegamos exactamente a 6, cerramos el teclado
            if (passwordInput.value.length === 6) {
                keypad.classList.remove('active');
            }
        });
    });

    // 3. Botón para borrar el último número
    btnDel.addEventListener('click', (e) => {
        e.preventDefault();
        passwordInput.value = passwordInput.value.slice(0, -1);
    });

    // 4. Botón para borrar toda la contraseña (Basurero)
    btnClear.addEventListener('click', (e) => {
        e.preventDefault();
        
        // 1. Borra todo el texto
        passwordInput.value = ''; 
        
        // 2. Cierra el teclado automáticamente
        keypad.classList.remove('active'); 
    });

    // 5. Ocultar teclado al hacer clic en cualquier otro lado de la pantalla
    document.addEventListener('click', (e) => {
        // Si no hizo clic dentro del teclado ni en el input, se cierra
        if (!keypad.contains(e.target) && e.target !== passwordInput) {
            keypad.classList.remove('active');
        }
    });

    const togglePassword = document.getElementById('togglePassword');
    
    togglePassword.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation(); // Evita que se cierre el teclado
        
        // Cambiar entre password (oculto) y text (visible)
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        // Cambiar el icono
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });
});

