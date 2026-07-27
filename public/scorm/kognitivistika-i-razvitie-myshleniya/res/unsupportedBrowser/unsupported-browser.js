/* eslint-disable no-var */

var SAFARI_MIN_SUPPORTED_VERSION = '16.0.0'

/**
 * @param {string} version
 */
function parseVersion(version) {
	return version.split('.').map(Number)
}

/**
 * @param {string} currentVersion
 * @param {string} minSupportedVersion
 */
function isSupportedVersion(currentVersion, minSupportedVersion) {
	var parsedCurrentVersion = parseVersion(currentVersion)
	var parsedMinSupportedVersion = parseVersion(minSupportedVersion)

	for (var i = 0; i < Math.max(parsedCurrentVersion.length, parsedMinSupportedVersion.length); i++) {
		var currentVersionNum = parsedCurrentVersion[i] || 0
		var minSupportedVersionNum = parsedMinSupportedVersion[i] || 0
		if (currentVersionNum !== minSupportedVersionNum) {
			return currentVersionNum > minSupportedVersionNum
		}
	}
	return true
}

function isSafari() {
	var userAgent = window.navigator.userAgent
	return userAgent.match(/Safari/i) && !userAgent.match(/(Chrome|CriOS|FxiOS|YaBrowser)/i)
}

function getSafariVersion() {
	var userAgent = window.navigator.userAgent
	var matchVersion = userAgent.match(/Version\/([\d|.]+)/)
	return matchVersion && matchVersion[1]
}

function isSupportedSafariVersion() {
	var safariVersion = getSafariVersion()

	if (safariVersion) {
		return isSupportedVersion(safariVersion, SAFARI_MIN_SUPPORTED_VERSION)
	}
	return false
}

function isIE() {
	return window.navigator.userAgent.indexOf('MSIE') !== -1
		|| window.navigator.userAgent.indexOf('Trident') !== -1
}

function isSupportedBrowser() {
	if (isSafari()) {
		return isSupportedSafariVersion()
	}

	var supportedBrowser = !isIE()

	if (!supportedBrowser) {
		/*
		* Дополнительная проверка на запуск внутри WebView:
		* страница может быть запущена в WebView (не обязательного нашего приложения),
		* в этом случае не удается определить ни один из поддерживаемых браузеров
		* ВАЖНО: дополнительная проверка выполняется после проверки на поддерживаемые браузеры.
		* Если не удалось определить один из браузеров; выполнение этой
		* проверки в отрыве от проверки на поддерживаемые браузеры может дать ложные срабатывания
		*/
		var userAgent = window.navigator.userAgent
		supportedBrowser = !!userAgent.match(/(iPod|iPhone|iPad|Android|Mac)/) && !!userAgent.match(/WebKit/i)
	}

	return supportedBrowser
}

if (!isSupportedBrowser()) {
	window.location.replace('./unsupportedBrowser/unsupported-browser.html')
}
