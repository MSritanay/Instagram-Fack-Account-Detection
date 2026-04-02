
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './pages.css';
import Popup from '../components/Popup';
import '../components/Popup.css';
import AuthLayout from './AuthLayout';

const Signup: React.FC = () => {
    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [popup, setPopup] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const response = await fetch('http://localhost:5000/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, fullName, username, password }),
        });
        const data = await response.json();
        if (response.ok) {
            setPopup({ message: data.message, type: 'success' });
            setTimeout(() => navigate('/login'), 2000);
        } else {
            setPopup({ message: data.message, type: 'error' });
        }
    };

    return (
        <>
            {popup && <Popup message={popup.message} type={popup.type} onClose={() => setPopup(null)} />}
            <AuthLayout>
                <h1>Sign Up</h1>
                <form onSubmit={handleSubmit}>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        required
                    />
                    <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Full Name"
                        required
                    />
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
                    <button type="submit">Sign Up</button>
                </form>
                <p>Already have an account? <Link to="/login">Login</Link></p>
            </AuthLayout>
        </>
    );
};

export default Signup;