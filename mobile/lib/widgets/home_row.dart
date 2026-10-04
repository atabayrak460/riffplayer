import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../app_colors.dart';

/// A horizontally-scrolling row of cards, used throughout the Home page.
class HomeRow extends StatelessWidget {
  final String title;
  final String? viewAllTo;
  final List<Widget> children;

  const HomeRow(
      {super.key, required this.title, this.viewAllTo, required this.children});

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title.toUpperCase(),
                style: TextStyle(
                  color: AppColors.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.2,
                ),
              ),
              if (viewAllTo != null)
                GestureDetector(
                  onTap: () => context.push(viewAllTo!),
                  child: Text(
                    'See all',
                    style: TextStyle(color: AppColors.muted, fontSize: 12),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 190,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: children.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, i) => children[i],
            ),
          ),
        ],
      );
}
