import LoginForm from '@/components/LoginForm';
import './login.css';

export const metadata = {
  title: 'Optimia - Iniciar sesión',
};

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params?.error === 'string' ? params.error : '';

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
          <p>Ingresa con tus credenciales o con tu cuenta de Google</p>
          <LoginForm initialError={error} />
        </div>
      </div>
    </>
  );
}
