
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './pages.css';
import Popup from '../components/Popup';
import '../components/Popup.css';
import AuthLayout from './AuthLayout';
import { setAdminToken } from '../lib/token-store';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000';

const AdminLogin: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [popup, setPopup] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await response.json();
            if (response.ok) {
                setAdminToken(data.token);
                setPopup({ message: data.message, type: 'success' });
                setTimeout(() => navigate('/admin/dashboard'), 600);
            } else {
                setPopup({ message: data.message || 'Admin login failed.', type: 'error' });
            }
        } catch (error: any) {
            setPopup({ message: error?.message || 'Unable to reach admin server.', type: 'error' });
        }
    };

    return (
        <>
            {popup && <Popup message={popup.message} type={popup.type} onClose={() => setPopup(null)} />}
            <AuthLayout>
                <h1>Admin Login</h1>
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
                <p>Are you a user? <Link to="/login">User Login</Link></p>
            </AuthLayout>
        </>
    );
};

export default AdminLogin;
