
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './pages.css';
import Popup from '../components/Popup';
import '../components/Popup.css';
import AuthLayout from './AuthLayout';
import { setAuthToken } from '../lib/token-store';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [popup, setPopup] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const response = await fetch('http://localhost:5000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (response.ok) {
            setPopup({ message: data.message, type: 'success' });
            setAuthToken(data.token);
            sessionStorage.setItem('user', JSON.stringify(data.user));
            
            // Signal to the content script that the user has logged in.
            window.postMessage({ type: 'INSTAGRAM_AUTHENTICATION_USER_LOGGED_IN' }, window.location.origin);

            setTimeout(() => navigate('/user/dashboard'), 2000);
        } else {
            setPopup({ message: data.message, type: 'error' });
        }
    };

    return (
        <>
            {popup && <Popup message={popup.message} type={popup.type} onClose={() => setPopup(null)} />}
            <AuthLayout>
                <h1>Login</h1>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Username"
                        required
                    />
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        required
                    />
                    <button type="submit">Login</button>
                </form>
                <p>Don't have an account? <Link to="/signup">Sign up</Link></p>
                <p>Are you an admin? <Link to="/admin/login">Admin Login</Link></p>
            </AuthLayout>
        </>
    );
};

export default Login;
