// ======================================================
// BASIC SETUP
// ======================================================
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://swiftbook.web.app"
    ],
    credentials: true
}));
app.use(express.json());

// ======================================================
// FIREBASE ADMIN SETUP
// ======================================================
const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// ======================================================
// TOKEN VERIFY MIDDLEWARE
// ======================================================
const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

    const token = authHeader.split(" ")[1];

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;
        req.decoded_uid = decoded.uid; // added uid for payment route
        next();
    } catch (err) {
        console.error("TOKEN ERROR:", err);
        return res.status(401).send({ message: "Invalid Token" });
    }
};

// ======================================================
// MONGODB CONNECTION
// ======================================================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xr2sv5h.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db, usersCollection, booksCollection, ordersCollection, wishlistCollection, reviewsCollection, paymentCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("swiftbook_db");

        usersCollection = db.collection("users");
        booksCollection = db.collection("books");
        ordersCollection = db.collection("orders");
        wishlistCollection = db.collection("wishlist");
        reviewsCollection = db.collection("reviews");
        paymentCollection = db.collection('payments');

        console.log("MongoDB Connected Successfully");
    } catch (error) {
        console.error("MongoDB Connection Error:", error);
    }
}
connectDB();

// ======================================================
// ROLE CHECK MIDDLEWARES
// ======================================================
const verifyAdmin = async (req, res, next) => {
    const user = await usersCollection.findOne({ email: req.decoded_email });
    if (!user || user.role !== "admin") return res.status(403).send({ message: "Forbidden" });
    next();
};

const verifyLibrarian = async (req, res, next) => {
    const user = await usersCollection.findOne({ email: req.decoded_email });
    if (!user || (user.role !== "librarian" && user.role !== "admin"))
        return res.status(403).send({ message: "Forbidden" });
    next();
};

const verifyAdminOrLibrarian = async (req, res, next) => {
    const user = await usersCollection.findOne({ email: req.decoded_email });
    if (!user || (user.role !== "admin" && user.role !== "librarian"))
        return res.status(403).send({ message: "Admin/Librarian only" });
    next();
};

// ======================================================
// USERS API
// ======================================================
app.post('/users', async (req, res) => {
    const user = req.body;
    user.role = "user";
    user.createdAt = new Date();

    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) return res.send({ message: "user exists" });

    const result = await usersCollection.insertOne(user);
    res.send(result);
});

app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
});

app.get('/users/:email/role', async (req, res) => {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });
    res.send({ role: user?.role || "user" });
});

app.patch('/users/role/:id', verifyFBToken, verifyAdmin, async (req, res) => {
    const { role } = req.body;
    const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role } }
    );
    res.send(result);
});

app.delete('/users/:id', verifyFBToken, verifyAdmin, async (req, res) => {
    const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
});

// ======================================================
// BOOK API
// ======================================================
app.post('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
    const result = await booksCollection.insertOne(req.body);
    res.send(result);
});

app.get('/books', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
    const user = await usersCollection.findOne({ email: req.decoded_email });

    const result = (user.role === "admin" || user.role === "librarian")
        ? await booksCollection.find().toArray()
        : await booksCollection.find({ status: "published" }).toArray();

    res.send(result);
});

app.get('/books/published', async (req, res) => {
    const result = await booksCollection.find({ status: "published" }).toArray();
    res.send(result);
});

app.get('/books/published/:id', async (req, res) => {
    try {
        const result = await booksCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!result) return res.status(404).send({ message: "Book not found" });
        res.send(result);
    } catch {
        res.status(400).send({ message: "Invalid ID" });
    }
});

app.put('/books/:id', verifyFBToken, verifyAdminOrLibrarian, async (req, res) => {
    const result = await booksCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
    );
    res.send(result);
});

app.delete('/books/:id', verifyFBToken, verifyAdmin, async (req, res) => {
    const result = await booksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
});

// ======================================================
// ORDER API
// ======================================================
app.post('/orders', verifyFBToken, async (req, res) => {
    const order = req.body;
    order.createdAt = new Date();
    order.status = "pending";
    order.paymentStatus = "unpaid";

    const result = await ordersCollection.insertOne(order);
    res.send(result);
});

app.get('/orders/:email', verifyFBToken, async (req, res) => {
    if (req.params.email !== req.decoded_email)
        return res.status(403).send({ message: "Forbidden" });

    const result = await ordersCollection.find({ customerEmail: req.params.email }).toArray();
    res.send(result);
});

app.get('/orders', verifyFBToken, verifyLibrarian, async (req, res) => {
    const result = await ordersCollection.find().toArray();
    res.send(result);
});

app.delete('/orders/:id', verifyFBToken, async (req, res) => {
    const result = await ordersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
});

// ======================================================
// WISHLIST API
// ======================================================
app.post('/wishlist', verifyFBToken, async (req, res) => {
    const wishlist = req.body;
    wishlist.customerEmail = wishlist.userEmail;
    delete wishlist.userEmail;
    wishlist.createdAt = new Date();

    const result = await wishlistCollection.insertOne(wishlist);
    res.send(result);
});

app.get('/wishlist/:email', verifyFBToken, async (req, res) => {
    if (req.params.email !== req.decoded_email)
        return res.status(403).send({ message: "Forbidden" });

    const result = await wishlistCollection
        .find({ customerEmail: req.params.email })
        .toArray();

    res.send(result);
});

app.delete('/wishlist/:id', verifyFBToken, async (req, res) => {
    const result = await wishlistCollection.deleteOne({
        _id: new ObjectId(req.params.id)
    });
    res.send(result);
});

// ======================================================
// REVIEWS API
// ======================================================
app.post('/reviews', verifyFBToken, async (req, res) => {
    try {
        const { bookId, userEmail, rating, comment, userName, userPhoto } = req.body;

        const hasPurchased = await ordersCollection.findOne({
            bookId: bookId,
            customerEmail: userEmail
        });

        if (!hasPurchased) {
            return res.status(403).send({ message: "You must purchase this book to review" });
        }

        const alreadyReviewed = await reviewsCollection.findOne({
            bookId: bookId,
            userEmail: userEmail
        });

        if (alreadyReviewed) {
            return res.status(400).send({ message: "You already reviewed this book" });
        }

        const review = {
            bookId,
            userEmail,
            userName,
            userPhoto,
            rating,
            comment,
            date: new Date()
        };

        const result = await reviewsCollection.insertOne(review);
        res.send(result);
    } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to add review" });
    }
});

app.get('/reviews/:bookId', async (req, res) => {
    const { bookId } = req.params;
    const reviews = await reviewsCollection.find({ bookId }).sort({ date: -1 }).toArray();
    res.send(reviews);
});

app.get('/reviews/can/:bookId/:email', verifyFBToken, async (req, res) => {
    const { bookId, email } = req.params;

    const order = await ordersCollection.findOne({
        bookId,
        customerEmail: email
    });

    const review = await reviewsCollection.findOne({
        bookId,
        userEmail: email
    });

    res.send({
        canReview: !!order && !review
    });
});

// ======================================================
// PAYMENT API
// ======================================================
app.post('/create-checkout-session', async (req, res) => {
    try {
        const paymentInfo = req.body;
        const amount = parseInt(paymentInfo.cost) * 100;

        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: 'EUR',
                        unit_amount: amount,
                        product_data: {
                            name: `Please pay for: ${paymentInfo.bookTitle || paymentInfo.parcelName}`
                        }
                    },
                    quantity: 1,
                },
            ],
            customer_email: paymentInfo.customerEmail,
            mode: 'payment',
            metadata: {
                bookId: paymentInfo.bookId || paymentInfo.parcelId,
                bookTitle: paymentInfo.bookTitle || paymentInfo.parcelName,
            },
            success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
    } catch (error) {
        console.error("Stripe session creation failed", error);
        res.status(500).send({ message: "Failed to create Stripe session" });
    }
});

app.patch("/payment-success", verifyFBToken, async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.status(400).send({ message: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Avoid duplicate record
        const existingPayment = await paymentCollection.findOne({
            transactionId: session.payment_intent
        });

        if (existingPayment) {
            return res.send({
                success: true,
                paymentInfo: existingPayment,
                transactionId: existingPayment.transactionId
            });
        }

        // Create payment object
        const payment = {
            userId: req.decoded_uid,
            customerEmail: session.customer_email,
            transactionId: session.payment_intent,
            amount: session.amount_total / 100,
            bookId: session.metadata.bookId,
            bookTitle: session.metadata.bookTitle,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
        };

        // Insert into DB
        await paymentCollection.insertOne(payment);

        // Update order payment status
        await ordersCollection.updateOne(
            {
                bookId: session.metadata.bookId,
                customerEmail: session.customer_email
            },
            { $set: { paymentStatus: "paid" } }
        );

        // Return actual payment object (THIS FIXES YOUR ERROR)
        res.send({
            success: true,
            paymentInfo: payment,
            transactionId: session.payment_intent
        });

    } catch (error) {
        console.error("Payment success error:", error);
        res.status(500).send({ success: false, message: "Payment failed" });
    }
});

app.get('/payments', verifyFBToken, async (req, res) => {
    const email = req.query.email;
    if (email !== req.decoded_email) return res.status(403).send({ message: "Forbidden" });

    const payments = await paymentCollection.find({ customerEmail: email }).sort({ paidAt: -1 }).toArray();
    res.send(payments);
});

// ======================================================
// PING ROUTE
// ======================================================
app.get("/ping", (req, res) => {
    res.send("pong");
});

// ======================================================
// BASE API
// ======================================================
app.get("/", (req, res) => {
    res.send("SwiftBook server is running");
});

// ======================================================
// START SERVER
// ======================================================
app.listen(port, () => {
    console.log(`SwiftBook running on port ${port}`);
});
