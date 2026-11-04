package org.example.tvchallenge;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;

/** Small vector glyphs stay sharp at 4K; only the primary glyph breathes. */
final class BreakStatusIcon extends View {

  static final int REST = 0;
  static final int PAUSE = 1;
  static final int CLOCK = 2;
  static final int CHECK = 3;
  static final int WAIT = 4;
  static final int PHONE = 5;
  static final int BACK = 6;
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path path = new Path();
  private final boolean primary;
  private ValueAnimator breathing;
  private boolean active;
  private int kind = REST;

  public BreakStatusIcon(Context context) {
    this(context, false);
  }

  BreakStatusIcon(Context context, boolean primary) {
    super(context);
    this.primary = primary;
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    paint.setStrokeCap(Paint.Cap.ROUND);
    paint.setStrokeJoin(Paint.Join.ROUND);
  }

  void setKind(int kind) {
    this.kind = kind;
    invalidate();
  }

  void setActive(boolean active) {
    this.active = active;
    updateAnimation();
  }

  private void updateAnimation() {
    boolean animate =
      primary &&
      active &&
      isAttachedToWindow() &&
      getWindowVisibility() == VISIBLE &&
      ValueAnimator.areAnimatorsEnabled();
    if (animate && breathing == null) {
      breathing = ValueAnimator.ofFloat(0.72f, 1f);
      breathing.setDuration(3200);
      breathing.setRepeatMode(ValueAnimator.REVERSE);
      breathing.setRepeatCount(ValueAnimator.INFINITE);
      breathing.setInterpolator(new AccelerateDecelerateInterpolator());
      breathing.addUpdateListener(value ->
        setAlpha((float) value.getAnimatedValue())
      );
      breathing.start();
    } else if (!animate && breathing != null) {
      breathing.cancel();
      breathing = null;
      setAlpha(1f);
    }
  }

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    updateAnimation();
  }

  @Override
  protected void onDetachedFromWindow() {
    active = false;
    updateAnimation();
    super.onDetachedFromWindow();
  }

  @Override
  protected void onWindowVisibilityChanged(int visibility) {
    super.onWindowVisibilityChanged(visibility);
    updateAnimation();
  }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    canvas.save();
    float size = Math.min(getWidth(), getHeight());
    canvas.translate((getWidth() - size) / 2, (getHeight() - size) / 2);
    canvas.scale(size / 80f, size / 80f);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(primary ? 1.2f : 4f);
    paint.setColor(primary ? 0x605464ae : 0xff4f5c85);
    if (primary) {
      canvas.drawCircle(40, 40, 38, paint);
      canvas.translate(14, 14);
      canvas.scale(0.65f, 0.65f);
      paint.setStrokeWidth(3.2f);
      paint.setColor(0xff5961a6);
    }
    path.reset();
    switch (kind) {
      case PAUSE:
        canvas.drawLine(31, 23, 31, 57, paint);
        canvas.drawLine(49, 23, 49, 57, paint);
        break;
      case CLOCK:
        canvas.drawCircle(40, 40, 24, paint);
        path.moveTo(40, 24);
        path.lineTo(40, 40);
        path.lineTo(51, 47);
        canvas.drawPath(path, paint);
        break;
      case CHECK:
        path.moveTo(22, 40);
        path.lineTo(35, 53);
        path.lineTo(59, 28);
        canvas.drawPath(path, paint);
        break;
      case WAIT:
        canvas.drawLine(25, 18, 55, 18, paint);
        canvas.drawLine(25, 62, 55, 62, paint);
        path.moveTo(28, 19);
        path.cubicTo(28, 34, 52, 46, 52, 61);
        path.moveTo(52, 19);
        path.cubicTo(52, 34, 28, 46, 28, 61);
        canvas.drawPath(path, paint);
        break;
      case PHONE:
        canvas.drawRoundRect(23, 10, 57, 70, 6, 6, paint);
        canvas.drawLine(35, 58, 45, 58, paint);
        break;
      case BACK:
        path.moveTo(34, 22);
        path.lineTo(18, 37);
        path.lineTo(34, 52);
        path.moveTo(19, 37);
        path.lineTo(49, 37);
        path.cubicTo(67, 37, 67, 61, 49, 61);
        canvas.drawPath(path, paint);
        break;
      default:
        path.moveTo(48, 16);
        path.cubicTo(19, 13, 10, 47, 31, 61);
        path.cubicTo(46, 71, 64, 60, 65, 47);
        path.cubicTo(42, 55, 29, 29, 48, 16);
        canvas.drawPath(path, paint);
    }
    canvas.restore();
  }
}
