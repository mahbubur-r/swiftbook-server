# SwiftBook Server

This is the backend server for **SwiftBook**, a book management and e-commerce platform. It provides APIs for users, books, orders, wishlist, reviews, payments, and dashboards. The server uses **Node.js**, **Express**, **MongoDB**, **Firebase Admin**, and **Stripe**.

---

## Live URLs

- **Client (Frontend):** [https://swiftbook.web.app](https://swiftbook.web.app)  
- **Server (Backend):** [https://swiftbook-server.vercel.app](https://swiftbook-server.vercel.app)

---

## Features

- **User Management:** Create, read, update, delete users, and manage roles (user, librarian, admin).  
- **Book Management:** Add, update, delete, and fetch books (with published/private access).  
- **Orders:** Create, read, and delete orders.  
- **Wishlist:** Add, get, and delete wishlist items.  
- **Reviews:** Add and fetch book reviews (restricted to purchased books).  
- **Payments:** Stripe integration for payment sessions and updates.  
- **Dashboards:** Admin, Librarian, and User statistics endpoints.  
- **Authentication:** Firebase ID token verification with role-based access control.  
- **CORS:** Configured for local development and deployed client.

---

## Technologies

- Node.js & Express  
- MongoDB (Atlas)  
- Firebase Admin SDK  
- Stripe Payments  

---

## Setup

1. Clone the repository:  
   ```bash
   git clone <repo-url>
   cd server
