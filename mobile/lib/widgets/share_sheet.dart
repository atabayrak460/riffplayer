import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:gal/gal.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../app_colors.dart';
import '../utils/snackbar.dart';

/// What the sheet does with the finished pictures. A seam so tests don't need a phone.
abstract class SharePicturesActions {
  Future<void> share(List<Uint8List> pictures, String title);
  Future<void> saveToGallery(List<Uint8List> pictures, String title);
}

/// Android's share sheet and the photo gallery.
class PlatformSharePicturesActions implements SharePicturesActions {
  const PlatformSharePicturesActions();

  /// A file name that is safe on any file system.
  static String fileName(String title, int index, int total) {
    final base = title
        .replaceAll(RegExp(r'[^\p{L}\p{N} ._-]', unicode: true), '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .replaceFirst(RegExp(r'^[. ]+'), '')
        .trim();
    final safe = base.isEmpty
        ? 'riffplayer'
        : base.substring(0, base.length > 60 ? 60 : base.length);
    return total > 1 ? '$safe ${index + 1}' : safe;
  }

  @override
  Future<void> share(List<Uint8List> pictures, String title) async {
    final dir = await getTemporaryDirectory();
    final files = <XFile>[];
    for (var i = 0; i < pictures.length; i++) {
      final file =
          File('${dir.path}/${fileName(title, i, pictures.length)}.png');
      await file.writeAsBytes(pictures[i]);
      files.add(XFile(file.path, mimeType: 'image/png'));
    }
    await SharePlus.instance.share(ShareParams(files: files, title: title));
  }

  @override
  Future<void> saveToGallery(List<Uint8List> pictures, String title) async {
    for (var i = 0; i < pictures.length; i++) {
      await Gal.putImageBytes(pictures[i],
          name: fileName(title, i, pictures.length));
    }
  }
}

/// Builds the pictures (on the server), shows a preview, and offers Share / Save to gallery.
Future<void> showSharePicturesSheet(
  BuildContext context, {
  required String title,
  required Future<List<Uint8List>> Function() load,
  SharePicturesActions actions = const PlatformSharePicturesActions(),
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    builder: (_) =>
        SharePicturesSheet(title: title, load: load, actions: actions),
  );
}

class SharePicturesSheet extends StatefulWidget {
  const SharePicturesSheet({
    super.key,
    required this.title,
    required this.load,
    required this.actions,
  });

  final String title;
  final Future<List<Uint8List>> Function() load;
  final SharePicturesActions actions;

  @override
  State<SharePicturesSheet> createState() => _SharePicturesSheetState();
}

class _SharePicturesSheetState extends State<SharePicturesSheet> {
  List<Uint8List>? _pictures;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    widget.load().then((p) {
      if (mounted) setState(() => _pictures = p);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = 'Couldn\'t create the picture.');
    });
  }

  Future<void> _run(Future<void> Function(List<Uint8List>, String) action,
      String done) async {
    final pictures = _pictures;
    if (pictures == null || _busy) return;
    setState(() => _busy = true);
    try {
      await action(pictures, widget.title);
      if (mounted && done.isNotEmpty) {
        showSnackBar(context, done);
      }
    } catch (e) {
      if (mounted) showFailureSnackBar(context, 'That didn\'t work: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pictures = _pictures;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Share as picture',
                style: TextStyle(
                    color: AppColors.text,
                    fontSize: 18,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            SizedBox(
              height: 320,
              child: _error != null
                  ? Center(
                      child: Text(_error!,
                          style: TextStyle(color: AppColors.danger)))
                  : pictures == null
                      ? const Center(child: CircularProgressIndicator())
                      : ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: pictures.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(width: 12),
                          itemBuilder: (_, i) => ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child:
                                Image.memory(pictures[i], fit: BoxFit.contain),
                          ),
                        ),
            ),
            if (pictures != null && pictures.length > 1)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                    '${pictures.length} pictures — they are shared together.',
                    style: TextStyle(color: AppColors.muted, fontSize: 12)),
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: pictures == null || _busy
                        ? null
                        : () => _run(widget.actions.share, ''),
                    icon: const Icon(Icons.ios_share),
                    label: const Text('Share'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: pictures == null || _busy
                        ? null
                        : () => _run(widget.actions.saveToGallery,
                            'Saved to your gallery'),
                    icon: const Icon(Icons.download),
                    label: const Text('Save to gallery'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
