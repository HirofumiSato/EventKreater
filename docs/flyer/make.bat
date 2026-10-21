@ECHO OFF
pushd %~dp0
python -m sphinx -M %1 . _build %SPHINXOPTS%
set EXITCODE=%ERRORLEVEL%
popd
exit /b %EXITCODE%
