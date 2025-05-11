import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class ScriptService {
  static const String _scriptsKey = 'saved_scripts';
  static const String _environmentsKey = 'saved_environments';
  final SharedPreferences _prefs;

  ScriptService(this._prefs);

  Future<List<String>> getSavedScripts() async {
    return _prefs.getStringList(_scriptsKey) ?? [];
  }

  Future<void> saveScript(String scriptPath) async {
    final scripts = await getSavedScripts();
    if (!scripts.contains(scriptPath)) {
      scripts.add(scriptPath);
      await _prefs.setStringList(_scriptsKey, scripts);
    }
  }

  Future<void> removeScript(String scriptPath) async {
    final scripts = await getSavedScripts();
    scripts.remove(scriptPath);
    await _prefs.setStringList(_scriptsKey, scripts);
  }

  Future<Map<String, Map<String, String>>> getSavedEnvironments() async {
    final envsJson = _prefs.getString(_environmentsKey);
    if (envsJson == null) return {};
    try {
      final Map<String, dynamic> decoded = jsonDecode(envsJson);
      return decoded.map((key, value) {
        if (value is Map) {
          return MapEntry(key, Map<String, String>.from(value.map(
            (k, v) => MapEntry(k.toString(), v.toString())
          )));
        }
        return MapEntry(key, <String, String>{});
      });
    } catch (e) {
      print('Error decoding environments: $e');
      return {};
    }
  }

  Future<void> saveEnvironment(String name, Map<String, String> env) async {
    final envs = await getSavedEnvironments();
    envs[name] = env;
    await _prefs.setString(_environmentsKey, jsonEncode(envs));
  }

  Future<void> removeEnvironment(String name) async {
    final envs = await getSavedEnvironments();
    envs.remove(name);
    await _prefs.setString(_environmentsKey, jsonEncode(envs));
  }
} 