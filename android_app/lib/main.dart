import 'dart:io';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF08090D),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const LuminaApp());
}

class LuminaApp extends StatelessWidget {
  const LuminaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lumina',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF08090D),
        primaryColor: const Color(0xFF00F2FE),
      ),
      home: const LuminaHomeScreen(),
    );
  }
}

class LuminaHomeScreen extends StatefulWidget {
  const LuminaHomeScreen({super.key});

  @override
  State<LuminaHomeScreen> createState() => _LuminaHomeScreenState();
}

class _LuminaHomeScreenState extends State<LuminaHomeScreen> with SingleTickerProviderStateMixin {
  WebViewController? _controller;
  HttpServer? _server;
  int? _serverPort;
  bool _isWebViewReady = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _initLocalServerAndWebView();
  }

  Future<void> _initLocalServerAndWebView() async {
    try {
      // 1. Bind an internal loopback HTTP server to bypass Android WebView file:// CORS & ES module restrictions
      _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      _serverPort = _server!.port;

      _server!.listen((HttpRequest request) async {
        try {
          var reqPath = request.uri.path;
          if (reqPath == '/' || reqPath.isEmpty) {
            reqPath = '/index.html';
          }
          final assetKey = 'assets/web$reqPath';

          // Determine accurate MIME content type
          String contentType = 'application/octet-stream';
          if (reqPath.endsWith('.html')) {
            contentType = 'text/html; charset=utf-8';
          } else if (reqPath.endsWith('.js') || reqPath.endsWith('.mjs')) {
            contentType = 'application/javascript; charset=utf-8';
          } else if (reqPath.endsWith('.css')) {
            contentType = 'text/css; charset=utf-8';
          } else if (reqPath.endsWith('.png')) {
            contentType = 'image/png';
          } else if (reqPath.endsWith('.jpg') || reqPath.endsWith('.jpeg')) {
            contentType = 'image/jpeg';
          } else if (reqPath.endsWith('.svg')) {
            contentType = 'image/svg+xml';
          } else if (reqPath.endsWith('.json')) {
            contentType = 'application/json';
          } else if (reqPath.endsWith('.woff2')) {
            contentType = 'font/woff2';
          }

          final data = await rootBundle.load(assetKey);
          final bytes = data.buffer.asUint8List();

          request.response.headers.set('Content-Type', contentType);
          request.response.headers.set('Access-Control-Allow-Origin', '*');
          request.response.headers.set('Cache-Control', 'no-cache');
          request.response.add(bytes);
          await request.response.close();
        } catch (e) {
          // Fallback to index.html for client-side routing
          try {
            final fallback = await rootBundle.load('assets/web/index.html');
            request.response.headers.set('Content-Type', 'text/html; charset=utf-8');
            request.response.headers.set('Access-Control-Allow-Origin', '*');
            request.response.add(fallback.buffer.asUint8List());
            await request.response.close();
          } catch (_) {
            request.response.statusCode = HttpStatus.notFound;
            await request.response.close();
          }
        }
      });

      // 2. Configure WebViewController connecting to the loopback server
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xFF08090D))
        ..setNavigationDelegate(
          NavigationDelegate(
            onPageFinished: (String url) {
              if (mounted) {
                setState(() {
                  _isWebViewReady = true;
                });
              }
            },
            onWebResourceError: (WebResourceError error) {
              debugPrint('Lumina WebView Resource Error: ${error.description}');
            },
          ),
        )
        ..addJavaScriptChannel(
          'LuminaAndroidBridge',
          onMessageReceived: (JavaScriptMessage msg) {
            debugPrint('Lumina Native Bridge Message: ${msg.message}');
          },
        )
        ..loadRequest(Uri.parse('http://127.0.0.1:$_serverPort/index.html'));

      setState(() {
        _controller = controller;
      });
    } catch (err) {
      setState(() {
        _errorMessage = 'Failed to start local application service: $err';
      });
    }
  }

  @override
  void dispose() {
    _server?.close(force: true);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (_controller != null && await _controller!.canGoBack()) {
          await _controller!.goBack();
        } else {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF08090D),
        body: SafeArea(
          top: true,
          bottom: false,
          child: Stack(
            children: [
              if (_controller != null)
                WebViewWidget(controller: _controller!),
              if (!_isWebViewReady && _errorMessage == null)
                Container(
                  color: const Color(0xFF08090D),
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: const RadialGradient(
                              colors: [Color(0x6000F2FE), Colors.transparent],
                            ),
                            border: Border.all(color: const Color(0x3300F2FE), width: 1.5),
                          ),
                          child: const Padding(
                            padding: EdgeInsets.all(16.0),
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Color(0xFF00F2FE),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        const Text(
                          'LUMINA 2.0',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 2,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Starting local media engine...',
                          style: TextStyle(
                            fontSize: 12,
                            color: Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (_errorMessage != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline, color: Color(0xFFFF5F56), size: 48),
                        const SizedBox(height: 16),
                        Text(
                          _errorMessage!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white70, fontSize: 13),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () {
                            setState(() {
                              _errorMessage = null;
                              _isWebViewReady = false;
                            });
                            _initLocalServerAndWebView();
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF00F2FE),
                            foregroundColor: Colors.black,
                          ),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
