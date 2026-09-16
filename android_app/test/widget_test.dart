import 'package:flutter_test/flutter_test.dart';
import 'package:lumina_android/main.dart';

void main() {
  testWidgets('LuminaApp basic widget smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const LuminaApp());
    expect(find.byType(LuminaApp), findsOneWidget);
  });
}
