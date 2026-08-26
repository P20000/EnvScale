# Dark Theme CSS for localrun GTK GUI
CSS_STYLES = b"""
window {
    background-color: #111827;
    color: #f9fafb;
    font-family: 'Inter', 'Segoe UI', sans-serif;
}

headerbar {
    background-color: #1f2937;
    color: #f9fafb;
    border-bottom: 1px solid #374151;
}

.title-label {
    font-size: 16px;
    font-weight: bold;
    color: #38bdf8;
}

.subtitle-label {
    font-size: 12px;
    color: #9ca3af;
}

.card {
    background-color: #1f2937;
    border: 1px solid #374151;
    border-radius: 8px;
    padding: 12px;
}

.card-title {
    font-weight: bold;
    font-size: 13px;
    color: #e5e7eb;
}

.badge-online {
    background-color: #065f46;
    color: #34d399;
    border-radius: 12px;
    padding: 2px 10px;
    font-weight: bold;
    font-size: 11px;
}

.badge-offline {
    background-color: #7f1d1d;
    color: #f87171;
    border-radius: 12px;
    padding: 2px 10px;
    font-weight: bold;
    font-size: 11px;
}

.btn-test {
    background-image: none;
    background-color: #2563eb;
    color: #ffffff;
    font-weight: bold;
    border-radius: 6px;
    padding: 8px 16px;
}
.btn-test:hover { background-color: #1d4ed8; }

.btn-start {
    background-image: none;
    background-color: #059669;
    color: #ffffff;
    font-weight: bold;
    border-radius: 6px;
    padding: 8px 16px;
}
.btn-start:hover { background-color: #047857; }

.btn-stop {
    background-image: none;
    background-color: #dc2626;
    color: #ffffff;
    font-weight: bold;
    border-radius: 6px;
    padding: 8px 16px;
}
.btn-stop:hover { background-color: #b91c1c; }

.btn-open {
    background-image: none;
    background-color: #0891b2;
    color: #ffffff;
    font-weight: bold;
    border-radius: 6px;
    padding: 8px 16px;
}
.btn-open:hover { background-color: #0e7490; }

.btn-k8s-deploy {
    background-image: none;
    background-color: #7c3aed;
    color: #ffffff;
    font-weight: bold;
    border-radius: 6px;
    padding: 8px 16px;
}
.btn-k8s-deploy:hover { background-color: #6d28d9; }

.console-view {
    background-color: #030712;
    color: #38bdf8;
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
}
"""
