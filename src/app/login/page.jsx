import LoginForm from '@/components/LoginForm';
import './login.css';

export const metadata = {
  title: 'Optimia - Iniciar sesión',
};

export default function LoginPage() {
  return (
    <>
      <div className="header-app">
        <div className="container">
          <span className="brand-logo">Optimia</span>
        </div>
      </div>
      <div className="login-wrapper">
        <div className="login-card">
          <h2>Bienvenido a Optimia</h2>
          <p>Ingresa con tu usuario y contraseña</p>
          <LoginForm />
        </div>
      </div>
    </>
  );
}
