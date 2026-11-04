# 第三方许可

本仓库自有代码采用 MIT License，第三方材料不因收录而改换许可。

- Apple App Store Server Library：MIT；仅官方云订阅验证路径需要，版本及传递依赖见 `server/package-lock.json`。
- esbuild：MIT；仅构建时使用。
- Prettier：MIT；仅开发时使用。Java 格式化插件沿用其发布包许可。
- Android Gradle Plugin、AndroidX 测试库：沿用各自发布包许可；依赖声明见 `android/`。
- Apple G3 公共根证书：作为验证 Apple 签名的公共信任材料收录于 `server/certs/`，不是私钥或维护者证书。
- Apple 验证测试素材：保留 `server/test/fixtures/APPLE-LICENSE.txt`；其许可与应用自有代码分开。
- iOS 的系统框架和 SF Symbols 由 Apple 系统提供，使用需遵守 Apple 相关条款。

应用包名和品牌名称仅用于识别用户设备上的应用，不表示相关品牌背书或授权本项目分发第三方应用。

- React Bits 的 Silk、Aurora、Dark Veil 着色器：Copyright (c) 2026 David Haz，采用 MIT + Commons Clause；仅作为本应用背景集成，包含原生适配、浅色配色和单通道渲染改动。[完整许可](licenses/REACT_BITS_LICENSE.txt)。这些第三方文件不适用本项目的 MIT 再许可，不得单独出售或作为组件包再分发。来源：https://github.com/DavidHDev/react-bits 。
