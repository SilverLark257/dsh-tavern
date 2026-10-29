		// 宿主三栏的默认宽度由宿主自己的布局 store 决定：右栏首开是「视口 45%」
		// （1600 视口 = 720px），没有设置项、也不持久化。设计稿要求右栏 336px，
		// 而 CSS 里用 !important 钉死宽度会让宿主的拖动把手变成摆设（拖动只改内联
		// style，被 !important 压住）。所以这里换一条路：
		//
		//   1. 等右栏出现，走宿主自己的把手处理链（派发 PointerEvent 模拟一次拖动）
		//      把 rightbar 偏好归一化到 336px —— 宿主随之把 grid 第三列、面板内联
		//      width、把手位置全部算成 336，三栏恢复原生拖动，默认值仍是设计稿；
		//   2. 把左栏实际宽度发布成 CSS 变量 --dsh-tavern-sidebar-w，让侧栏里固定
		//      定位的「设置」按钮跟随拖动自适应，不再写死 206px。
		//
		// 归一化最多试 3 次，失败就放弃并恢复右栏可见；绝不长期隐藏右栏。

		/** 设计稿右栏宽度；宿主契约是 300..视口*0.7，336 在范围内。 */
		var TAVERN_DESIGN_RIGHTBAR_WIDTH = 336;
		/** 归一化期间给右栏盖一层“隐形”；超过这个时间就放弃并恢复显示。 */
		var TAVERN_NORMALIZE_GIVE_UP_MS = 2000;
		/** 归一化最多尝试次数（每次重试前重读把手位置）。 */
		var TAVERN_NORMALIZE_ATTEMPTS = 3;

		function installTavernLayoutDefaults() {
			if (typeof document === "undefined" || typeof window === "undefined") return;
			if (window.__dshTavernLayoutDefaultsInstalled) return;
			window.__dshTavernLayoutDefaultsInstalled = true;

			var normalized = false;
			var attempts = 0;
			var pending = false;
			var normalizingSince = 0;
			var sidebarElement = null;
			var sidebarObserver = null;
			var lastSidebarWidth = 0;

			function rightbarPanel() {
				return document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open="true"]');
			}

			/** 优先读宿主写在面板上的内联 width（那才是 preference），退回实测宽度。 */
			function panelWidth(panel) {
				var inline = parseFloat(String(panel.style && panel.style.width || "").replace("px", ""));
				if (isFinite(inline) && inline > 0) return inline;
				return panel.getBoundingClientRect().width;
			}

			function px(value) {
				return parseFloat(String(value || "").replace("px", ""));
			}

			function setHiding(hide) {
				if (!document.body) return;
				if (hide) {
					if (normalizingSince === 0) normalizingSince = Date.now();
					document.body.classList.add("dsh-tavern-layout-normalizing");
				} else {
					normalizingSince = 0;
					document.body.classList.remove("dsh-tavern-layout-normalizing");
				}
			}

			function finish(normalizedOk) {
				normalized = true;
				pending = false;
				setHiding(false);
				if (!normalizedOk) window.__dshTavernLayoutNormalizeFailed = true;
			}

			/**
			 * 用真实 PointerEvent 走一遍宿主的拖动处理链。
			 * 宿主的 pointerdown 会 setPointerCapture（未受信任事件会抛
			 * NotFoundError），所以临时把三个 pointer-capture 方法换成空实现。
			 */
			function dragHandle(handle, fromX, toX) {
				var dx = toX - fromX;
				if (!isFinite(dx) || Math.abs(dx) < 1) return false;
				var pointerId = 4242;
				var restores = [];
				var stubs = {
					setPointerCapture: function () {},
					releasePointerCapture: function () {},
					hasPointerCapture: function () { return true; }
				};
				for (var name in stubs) {
					if (!Object.prototype.hasOwnProperty.call(stubs, name)) continue;
					restores.push([name, handle[name]]);
					handle[name] = stubs[name];
				}
				var fire = function (type, x) {
					handle.dispatchEvent(new PointerEvent(type, {
						bubbles: true,
						cancelable: true,
						composed: true,
						pointerId: pointerId,
						pointerType: "mouse",
						isPrimary: true,
						button: type === "pointermove" ? -1 : 0,
						buttons: type === "pointerup" ? 0 : 1,
						clientX: x,
						clientY: 200
					}));
				};
				try {
					fire("pointerdown", fromX + 4);
					fire("pointermove", fromX + 4 + dx);
					fire("pointerup", fromX + 4 + dx);
				} finally {
					for (var i = 0; i < restores.length; i++) handle[restores[i][0]] = restores[i][1];
				}
				return true;
			}

			/** 一次归一化尝试；结果由短延时后的 settle 收尾（React 状态更新是异步的）。 */
			function normalizeRightbar() {
				if (normalized || pending) return;
				var panel = rightbarPanel();
				if (!panel) return;
				if (panel.getAttribute("data-sidebar-right-panel") === "fullscreen") return;
				if (Math.round(panelWidth(panel)) === TAVERN_DESIGN_RIGHTBAR_WIDTH) {
					normalized = true;
					return;
				}
				var handle = document.querySelector('[data-side="rightbar"]');
				if (!handle) return;
				var handleLeft = px(handle.style && handle.style.left);
				if (!isFinite(handleLeft)) handleLeft = handle.getBoundingClientRect().x;
				if (!isFinite(handleLeft) || handleLeft <= 0) return;
				if (attempts === 0) setHiding(true);
				attempts += 1;
				pending = true;
				dragHandle(handle, handleLeft, window.innerWidth - TAVERN_DESIGN_RIGHTBAR_WIDTH);
				window.setTimeout(settleRightbar, 160);
			}

			function settleRightbar() {
				pending = false;
				var panel = rightbarPanel();
				if (panel && Math.round(panelWidth(panel)) === TAVERN_DESIGN_RIGHTBAR_WIDTH) {
					finish(true);
					return;
				}
				if (attempts >= TAVERN_NORMALIZE_ATTEMPTS || Date.now() - normalizingSince > TAVERN_NORMALIZE_GIVE_UP_MS) {
					// 宿主没按预期响应（可能改版了）：放弃归一化，恢复可见，保持原生行为。
					finish(false);
					return;
				}
				normalizeRightbar();
			}

			/** 左栏实际宽度 → CSS 变量，供固定定位元素跟随。 */
			function measureSidebar() {
				if (!sidebarElement || !document.documentElement) return;
				var width = Math.round(sidebarElement.getBoundingClientRect().width);
				if (!isFinite(width) || width <= 0 || width === lastSidebarWidth) return;
				lastSidebarWidth = width;
				document.documentElement.style.setProperty("--dsh-tavern-sidebar-w", width + "px");
			}

			function watchSidebar() {
				var element = document.querySelector(".dsh-tavern-sidebar");
				if (!element || element === sidebarElement) return;
				sidebarElement = element;
				if (typeof window.ResizeObserver === "function") {
					if (sidebarObserver) sidebarObserver.disconnect();
					sidebarObserver = new window.ResizeObserver(measureSidebar);
					sidebarObserver.observe(element);
				}
				measureSidebar();
			}

			/** 标签栏是横向滚动容器：选中项被挤出可视区时，把它滚进来；两侧溢出时加渐隐。 */
			function keepActiveTabVisible() {
				var box = document.querySelector("[data-dockkit-strip-tabs]");
				if (!box) return;
				var active = box.querySelector('[data-dockkit-tab][aria-selected="true"]');
				if (active) {
					var boxRect = box.getBoundingClientRect();
					var tabRect = active.getBoundingClientRect();
					if (tabRect.width > 0) {
						if (tabRect.left < boxRect.left) box.scrollLeft += tabRect.left - boxRect.left - 4;
						else if (tabRect.right > boxRect.right) box.scrollLeft += tabRect.right - boxRect.right + 4;
					}
				}
				var overflow = box.scrollWidth - box.clientWidth;
				if (overflow <= 2) {
					box.removeAttribute("data-tv-fade-left");
					box.removeAttribute("data-tv-fade-right");
					return;
				}
				if (box.scrollLeft > 2) box.setAttribute("data-tv-fade-left", "");
				else box.removeAttribute("data-tv-fade-left");
				if (box.scrollLeft < overflow - 2) box.setAttribute("data-tv-fade-right", "");
				else box.removeAttribute("data-tv-fade-right");
			}

			function tick() {
				watchSidebar();
				normalizeRightbar();
				keepActiveTabVisible();
			}

			if (document.body) tick();
			else document.addEventListener("DOMContentLoaded", tick, { once: true });
			window.setInterval(tick, 400);
		}
