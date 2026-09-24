import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

class LoginScreen extends StatefulWidget {
  @override
  _LoginScreenState createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  Future<void> handleSignIn({
    required String email,
    required String password,
    required BuildContext context,
  }) async {
    // 1. Basic validation to prevent unnecessary network calls
    if (email.trim().isEmpty || password.isEmpty) {
      _showError(context, "Please enter both email and password.");
      return;
    }

    // 2. Show a loading indicator so the user knows an action is in progress
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    try {
      // 3. Make the sign-in call (MUST use await so try-catch works)
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      // Close loading indicator
      if (context.mounted) Navigator.of(context).pop();

      // Navigate to your main screen on success
      Navigator.pushReplacementNamed(context, '/home');

    } on FirebaseAuthException catch (e) {
      // Close loading indicator
      if (context.mounted) Navigator.of(context).pop();

      // 4. Translate raw Firebase error codes into user-friendly text
      String friendlyMessage = "An unexpected error occurred.";

      switch (e.code) {
        case 'invalid-email':
          friendlyMessage = "Please enter a valid email address.";
          break;
        case 'user-disabled':
          friendlyMessage = "This user account has been disabled.";
          break;
        case 'user-not-found':
        case 'wrong-password':
        case 'invalid-credential':
          // Firebase uses 'invalid-credential' as a secure fallback
          friendlyMessage = "Incorrect email or password. Please try again.";
          break;
        case 'network-request-failed':
          friendlyMessage = "Network error. Please check your internet connection.";
          break;
        default:
          friendlyMessage = e.message ?? friendlyMessage;
      }

      _showError(context, friendlyMessage);

    } catch (e) {
      // Close loading indicator
      if (context.mounted) Navigator.of(context).pop();
      _showError(context, "An error occurred: ${e.toString()}");
    }
  }

  void _showError(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.redAccent,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Login')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            TextField(
              controller: _emailController,
              decoration: InputDecoration(labelText: 'Email'),
            ),
            TextField(
              controller: _passwordController,
              obscureText: true,
              decoration: InputDecoration(labelText: 'Password'),
            ),
            SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                handleSignIn(
                  email: _emailController.text.trim(),
                  password: _passwordController.text,
                  context: context,
                );
              },
              child: Text('Login'),
            ),
          ],
        ),
      ),
    );
  }
}
