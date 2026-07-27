const loginForm = document.getElementById('loginForm');
const otpRequestForm = document.getElementById('otpRequestForm');
const message = document.getElementById('message');
const otpMessage = document.getElementById('otpMessage');

const ROLE_REDIRECTS = {
  developer: '/admin#developer',
  ceo: '/admin',
  admin: '/admin',
  project_manager: '/dashboard/project-manager',
  cashier: '/dashboard/cashier',
  employee: '/dashboard/employee',
  investor: '/dashboard/investor',
  member: '/member',
};

document.getElementById('showRecoveryLink')?.addEventListener('click', (event) => {
  event.preventDefault();
  loginForm.classList.add('hidden');
  otpRequestForm.classList.remove('hidden');
  const email = loginForm.email?.value;
  if (email && otpRequestForm.email) otpRequestForm.email.value = email;
});

document.getElementById('backToLoginBtn')?.addEventListener('click', () => {
  otpRequestForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  otpMessage.textContent = '';
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const formData = new FormData(loginForm);
  const payload = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      message.textContent = data.error || 'Login failed.';
      return;
    }

    window.location.href = data.user.redirectTo || ROLE_REDIRECTS[data.user.role] || '/member';
  } catch (error) {
    message.textContent = 'Unable to login. Please try again.';
  }
});

otpRequestForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  otpMessage.textContent = '';
  const email = new FormData(otpRequestForm).get('email');
  try {
    const response = await fetch('/api/auth/request-password-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) {
      otpMessage.textContent = data.error || 'Unable to send OTP.';
      return;
    }
    otpMessage.textContent = data.message
      + (data.emailSent === false
        ? ' (Email delivery unavailable — check with the Developer; OTP may be in server logs.)'
        : '');
  } catch (error) {
    otpMessage.textContent = 'Unable to request OTP. Please try again.';
  }
});
